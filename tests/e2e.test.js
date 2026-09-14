// End-to-end: the real worker runs bundled Java OpModes against the World,
// exactly as the browser does (Node worker_threads instead of a Web Worker).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { World } from '../src/sim/world.js';
import { createSharedMemory, viewsOf, initSharedDefaults, I, F, OpModeState, BUTTON_BITS } from '../src/sim/shared-memory.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = (f) => fs.readFileSync(path.join(here, '..', 'samples', f), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function seeded(seed = 5) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

async function session(code, opts = {}) {
  const mem = createSharedMemory();
  const v = viewsOf(mem);
  initSharedDefaults(v);
  const world = new World({ alliance: 'red', rng: seeded(), ...opts.world });
  world.attachShared(v);
  const worker = new Worker(new URL('../src/sdk/worker.js', import.meta.url), { type: 'module' });
  const s = { v, world, worker, telemetry: [], logs: [], opModes: null, done: false, error: null, warnings: [] };
  worker.on('message', (m) => {
    if (m.type === 'telemetry') s.telemetry = m.lines;
    else if (m.type === 'log') s.logs.push(m.text);
    else if (m.type === 'loaded') { s.opModes = m.opModes; s.warnings = m.warnings; }
    else if (m.type === 'done') s.done = true;
    else if (m.type === 'error') { s.error = m; s.done = true; }
  });
  worker.postMessage({ type: 'init', memory: mem });
  await wait(50);
  worker.postMessage({ type: 'load', code, language: 'java' });
  while (!s.opModes && !s.error) await wait(10);
  if (s.error) throw new Error('load failed: ' + s.error.message);
  s.run = async (seconds) => { for (let k = 0; k < seconds * 200 && !s.done; k++) { world.step(0.005); if (k % 20 === 0) await wait(1); } };
  /** Step the world until pred() holds or maxSeconds of simulated time pass. */
  s.runUntil = async (pred, maxSeconds) => { for (let t = 0; t < maxSeconds && !s.done && !pred(); t += 0.2) await s.run(0.2); await wait(20); return pred(); };
  s.start = () => Atomics.store(v.i32, I.STATE, OpModeState.RUNNING);
  s.stop = async () => { Atomics.store(v.i32, I.STOP_REQUESTED, 1); for (let k = 0; k < 400 && !s.done; k++) { world.step(0.005); await wait(2); } };
  s.close = () => worker.terminate();
  return s;
}

test('tank TeleOp sample: gamepad drives the robot, telemetry flows, STOP ends the OpMode', async () => {
  const s = await session(sample('01_BasicTankTeleop.java'));
  try {
    s.worker.postMessage({ type: 'run', name: s.opModes[0].name });
    await s.run(0.3);
    assert.equal(Atomics.load(s.v.i32, I.STATE), OpModeState.INIT);
    assert.deepEqual(s.telemetry, ['Status : Initialized']);
    s.start();
    s.v.f64[F.GP1_AXES + 1] = -1; // push the left stick forward
    const y0 = s.world.robot.y;
    await s.run(1.5);
    assert.ok(s.world.robot.y - y0 > 30, `robot moved forward ${s.world.robot.y - y0}`);
    const seen = await s.runUntil(() => s.telemetry.some((l) => l.startsWith('Motors : left (1.00)')), 3);
    assert.ok(seen, s.telemetry.join('|'));
    await s.stop();
    assert.equal(s.done, true);
    assert.equal(s.error, null);
  } finally { s.close(); }
});

test('encoder auto sample completes its path', async () => {
  const s = await session(sample('04_AutoDriveByEncoder.java'));
  try {
    s.worker.postMessage({ type: 'run', name: s.opModes[0].name });
    await s.run(0.3);
    s.start();
    const y0 = s.world.robot.y;
    await s.run(14);
    assert.equal(s.done, true, 'finished within 14 s');
    assert.equal(s.error, null);
    assert.deepEqual(s.telemetry, ['Path : Complete']);
    assert.ok(s.world.robot.y > y0 + 15, 'net forward movement after 48 fwd / turn / 24 back');
  } finally { s.close(); }
});

test('BIOBUZZ auto sample scores a HIVE TIP, leaves and parks', async () => {
  const s = await session(sample('06_BioBuzzAuto.java'));
  try {
    s.worker.postMessage({ type: 'run', name: s.opModes[0].name });
    await s.run(0.3);
    s.world.startPhase('auto');
    s.start();
    await s.run(20);
    assert.equal(s.error, null, s.error && s.error.message);
    assert.equal(s.world.hives.red.tips, 1);
    assert.equal(s.world.robot.left, true);
    assert.equal(s.world.robotInLoadingZone(), true);
    s.world.endPhase();
    assert.ok(s.world.score().red.total >= 20 + 3 + 5);
  } finally { s.close(); }
});

test('AprilTag sample sees the CELL clusters through VisionPortal', async () => {
  const s = await session(sample('07_AprilTagAim.java'));
  try {
    s.world.setRobotPose(60, -12.75, 180);
    s.worker.postMessage({ type: 'run', name: s.opModes[0].name });
    await s.run(0.3);
    s.start();
    const seen = await s.runUntil(() => s.telemetry.some((l) => /CLUSTER RED (AUDIENCE|SCORING)/.test(l)), 5);
    assert.ok(seen, s.telemetry.join('|'));
    assert.ok(s.telemetry.some((l) => /tag 3\d/.test(l)));
    await s.stop();
    assert.equal(s.error, null);
  } finally { s.close(); }
});

test('a runtime error in the OpMode is reported with the Java line number', async () => {
  const src = `import com.qualcomm.robotcore.eventloop.opmode.*;
import com.qualcomm.robotcore.hardware.DcMotor;
@TeleOp(name="Broken")
public class Broken extends LinearOpMode {
    public void runOpMode() {
        DcMotor m = hardwareMap.get(DcMotor.class, "no_such_motor");
        waitForStart();
    }
}`;
  const s = await session(src);
  try {
    s.worker.postMessage({ type: 'run', name: 'Broken' });
    await s.run(0.5);
    assert.ok(s.error, 'error reported');
    assert.match(s.error.message, /Unable to find a hardware device with name "no_such_motor"/);
    assert.match(s.error.stack || '', /OpModes\.js:6:/);
  } finally { s.close(); }
});
