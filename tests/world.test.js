import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.js';
import { createSharedMemory, viewsOf, initSharedDefaults, I, F, RunMode } from '../src/sim/shared-memory.js';
import { MotorModel } from '../src/sim/motor-model.js';
import { MOTORS, ROBOT_BODY } from '../src/sim/robot-config.js';

function seeded(seed = 1) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

function makeWorld(opts = {}) {
  const mem = createSharedMemory();
  const v = viewsOf(mem);
  initSharedDefaults(v);
  const w = new World({ alliance: 'red', rng: seeded(3), ...opts });
  w.attachShared(v);
  return { w, v };
}
const run = (w, seconds) => { for (let k = 0; k < seconds * 200; k++) w.step(0.005); };
const setDrive = (v, fl, fr, bl, br) => { [fl, fr, bl, br].forEach((p, i) => { v.f64[F.MOTOR_POWER_BASE + i] = p; }); };
const reverseLeft = (v) => { v.i32[I.MOTOR_DIR_BASE + 0] = 1; v.i32[I.MOTOR_DIR_BASE + 2] = 1; };

test('staging: 40 POLLEN and 16 NECTAR, 3 NECTAR in each up CELL, 4 preloaded', () => {
  const { w } = makeWorld();
  const pollen = w.balls.filter((b) => b.kind === 'pollen').length;
  const nectar = w.balls.filter((b) => b.kind === 'nectar').length;
  assert.equal(pollen, 16 + 8 + 4 + 12); // flowers + gardens + our preload + other robots' preloads
  assert.equal(nectar, 6);               // 3 in each up CELL; 10 more are staged off the field
  assert.equal(w.nectarOffField.red + w.nectarOffField.blue, 10);
  assert.equal(w.hives.red.upCell.length, 3);
  assert.equal(w.robot.magazine.length, 4);
  for (const f of w.flowers) assert.equal(f.stack.length, 4);
});

test('motor model: encoder counts per revolution and direction reversal', () => {
  const m = new MotorModel(MOTORS[0]);
  m.power = 1;
  for (let k = 0; k < 600; k++) m.step(0.005); // 3 s at full power (312 rpm => ~15 rev)
  const revs = m.encoder / m.ticksPerRev;
  assert.ok(revs > 13 && revs < 16, `revs ${revs}`);
  assert.ok(m.rpm > 300 && m.rpm <= 312.1);
  m.reversed = true;
  assert.ok(m.encoder < 0, 'REVERSE flips the encoder sign');
  m.resetEncoder();
  assert.equal(m.encoder, 0);
});

test('RUN_TO_POSITION reaches the target and reports not busy', () => {
  const m = new MotorModel(MOTORS[0]);
  m.mode = RunMode.RUN_TO_POSITION;
  m.targetPosition = 1000;
  m.power = 0.5;
  for (let k = 0; k < 800; k++) m.step(0.005);
  assert.ok(Math.abs(m.encoder - 1000) <= 12, `encoder ${m.encoder}`);
  assert.equal(m.isBusy(), false);
});

test('mecanum: equal power drives straight; opposite sides turn; the IMU tracks heading', () => {
  const { w, v } = makeWorld();
  reverseLeft(v);
  const x0 = w.robot.x, y0 = w.robot.y;
  setDrive(v, 0.5, 0.5, 0.5, 0.5);
  run(w, 1);
  assert.ok(w.robot.y - y0 > 20, 'moved forward (+Y at heading 90)');
  assert.ok(Math.abs(w.robot.x - x0) < 0.5, 'no sideways drift');
  assert.ok(Math.abs(v.f64[F.IMU_YAW]) < 0.5, 'yaw unchanged');
  setDrive(v, 0.5, -0.5, 0.5, -0.5); // FL, BL forward, right side back => clockwise
  run(w, 1);
  assert.ok(v.f64[F.IMU_YAW] < -20, `turned clockwise: yaw ${v.f64[F.IMU_YAW]}`);
  assert.ok(v.f64[F.MOTOR_ENC_BASE] > 0, 'encoders count');
});

test('mecanum strafe moves sideways', () => {
  const { w, v } = makeWorld();
  reverseLeft(v);
  w.setRobotPose(0, -40, 90);
  setDrive(v, 0.5, -0.5, -0.5, 0.5); // strafe right (toward +X at heading 90)
  run(w, 1);
  assert.ok(w.robot.x > 15, `strafed: x ${w.robot.x}`);
  assert.ok(Math.abs(w.robot.y + 40) < 3, 'little forward motion');
});

test('the robot cannot drive through the perimeter wall and the touch sensor reports contact', () => {
  const { w, v } = makeWorld();
  reverseLeft(v);
  w.setRobotPose(40, 0, 0); // facing the audience wall
  setDrive(v, 1, 1, 1, 1);
  run(w, 2);
  assert.ok(w.robot.x <= 72 - ROBOT_BODY.length / 2 + 0.01, `x ${w.robot.x}`);
  assert.equal(v.f64[F.TOUCH], 1);
});

test('the distance sensor sees the wall and reports out-of-range as 322.4 in', () => {
  const { w, v } = makeWorld();
  w.setRobotPose(40, 0, 0);
  run(w, 0.01);
  assert.ok(Math.abs(v.f64[F.DISTANCE_IN] - (72 - 40 - 9)) < 0.5, `distance ${v.f64[F.DISTANCE_IN]}`);
  w.setRobotPose(-40, 0, 0); // facing +X across the field: HIVE frame or far away
  run(w, 0.01);
  assert.ok(v.f64[F.DISTANCE_IN] > 20);
  w.setRobotPose(-60, 40, 0); // nothing within 78 in along this line
  run(w, 0.01);
  assert.equal(v.f64[F.DISTANCE_IN], 322.4);
});

test('a well-aimed shot scores in the HIVE and enough mass tips it', () => {
  const { w } = makeWorld();
  const shots = [];
  for (let i = 0; i < 5; i++) {
    const b = w.balls.find((x) => x.state === 'floor');
    w.releaseBall(b, 56, -12.75, 14, -240 * Math.cos(Math.PI / 3), 0, 240 * Math.sin(Math.PI / 3));
    run(w, 1.2);
    shots.push(b.state);
  }
  assert.ok(shots.filter((s) => s === 'cell').length >= 4, `shots: ${shots}`);
  run(w, 1.5);
  assert.equal(w.hives.red.tips, 1, 'HIVE tipped');
  assert.equal(w.hives.red.upSide, -1, 'the other CELL is now up');
  assert.equal(w.hives.red.upCell.length, 0);
  assert.equal(w.nectarUnlocked.red, 1);
  assert.ok(w.events.some((e) => /HIVE TIP #1/.test(e.text)));
});

test('a shot that is too slow misses (bounces off or falls short)', () => {
  const { w } = makeWorld();
  const b = w.balls.find((x) => x.state === 'floor');
  w.releaseBall(b, 56, -12.75, 14, -150 * Math.cos(Math.PI / 3), 0, 150 * Math.sin(Math.PI / 3));
  run(w, 2);
  assert.notEqual(b.state, 'cell');
});

test('intake collects POLLEN in front of the robot up to the possession limit, and refuses opponent NECTAR', () => {
  const { w, v } = makeWorld({ preload: 0 });
  w.setRobotPose(0, -40, 90);
  // place balls just in front of the intake
  const floor = w.balls.filter((b) => b.state === 'floor' && b.kind === 'pollen').slice(0, 6);
  floor.forEach((b, i) => { b.x = 0 + (i % 2) * 3 - 1.5; b.y = -40 + 12 + Math.floor(i / 2) * 3; b.vx = b.vy = 0; });
  v.f64[F.MOTOR_POWER_BASE + 4] = 1;
  run(w, 3);
  assert.equal(w.robot.magazine.length, 4);
  assert.equal(v.f64[F.MAGAZINE_COUNT], 4);
  // opponent NECTAR is not collected (G408)
  const blue = w.balls.find((b) => b.kind === 'nectar' && b.alliance === 'blue');
  w.robot.magazine.length = 0; w.balls.forEach((b) => { if (b.state === 'robot') b.state = 'off'; });
  blue.state = 'floor'; blue.x = 0; blue.y = -40 + 12; blue.vx = blue.vy = 0;
  run(w, 1);
  assert.equal(w.robot.magazine.length, 0);
  assert.equal(blue.state, 'floor');
});

test('feeder servo fires a ball when the launcher is up to speed', () => {
  const { w, v } = makeWorld();
  w.setRobotPose(56, -12.75, 180);
  v.f64[F.MOTOR_POWER_BASE + 5] = 0.43;
  v.f64[F.SERVO_POS_BASE + 1] = 1.0;
  run(w, 1.5);
  assert.ok(v.f64[F.LAUNCHER_RPM] > 2000);
  v.f64[F.SERVO_POS_BASE + 0] = 1.0;
  run(w, 0.5);
  assert.equal(w.robot.magazine.length, 3);
  assert.ok(w.events.some((e) => /Launched POLLEN/.test(e.text)));
});

test('AprilTag detections appear only when vision is enabled and the camera faces a CELL', () => {
  const { w, v } = makeWorld();
  w.setRobotPose(60, -12.75, 180);
  run(w, 0.1);
  assert.equal(v.i32[I.TAG_COUNT], 0);
  v.i32[I.VISION_ENABLED] = 1;
  run(w, 0.1);
  assert.ok(v.i32[I.TAG_COUNT] >= 5, `tags ${v.i32[I.TAG_COUNT]}`);
  const ids = [];
  for (let t = 0; t < v.i32[I.TAG_COUNT]; t++) ids.push(v.f64[F.TAG_BASE + t * 12]);
  assert.ok(ids.every((id) => id >= 30 && id <= 45));
  w.setRobotPose(60, -12.75, 0); // facing away
  run(w, 0.1);
  assert.equal(v.i32[I.TAG_COUNT], 0);
});

test('LEAVE and PARK are detected; score tallies them', () => {
  const { w, v } = makeWorld();
  w.startPhase('auto');
  assert.equal(w.score().red.left, false);
  reverseLeft(v);
  setDrive(v, 0.8, 0.8, 0.8, 0.8);
  run(w, 1.5);
  assert.equal(w.robot.left, true);
  const z = { x: -36, y: -63 };
  w.setRobotPose(z.x, z.y, 90);
  assert.equal(w.robotInLoadingZone(), true);
  w.endPhase();
  assert.equal(w.robot.parkedAuto, true);
  const s = w.score().red;
  assert.equal(s.leavePoints, 3);
  assert.equal(s.parkAutoPoints, 5);
  assert.equal(s.total, 3 + 5 + 3 * 2 + 4); // + 3 NECTAR in CELL + 4 GARDEN pollen
});

test('human player NECTAR loading follows the unlock rule', () => {
  const { w } = makeWorld();
  w.startPhase('teleop');
  assert.equal(w.loadNectar('red'), false, 'locked until a TIP');
  w.nectarUnlocked.red = 1;
  assert.equal(w.loadNectar('red'), true);
  assert.equal(w.nectarOffField.red, 4);
  assert.equal(w.loadNectar('red'), false);
});
