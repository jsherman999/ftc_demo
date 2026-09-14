// Application wiring: simulator loop, Driver Station, editor, worker.
import { World } from '../sim/world.js';
import { createSharedMemory, viewsOf, initSharedDefaults, I, F, OpModeState, MAX_MOTORS, MAX_SERVOS } from '../sim/shared-memory.js';
import { START_POSES } from '../field/geometry.js';
import { MATCH } from '../field/rules.js';
import { MOTORS, SERVOS, SENSORS, MOTOR_TYPES, ROBOT_BODY, MOTOR_GANGS } from '../sim/robot-config.js';
import { FieldRenderer } from './render.js';
import { InputManager } from './gamepad.js';
import { Editor } from './editor.js';

const $ = (id) => document.getElementById(id);
const STEP = 0.005;
const LS_CODE = 'ftc-biobuzz-code';
const LS_LANG = 'ftc-biobuzz-lang';
const LS_PROGRAMS = 'ftc-biobuzz-programs';   // { name: { code, language, savedAt } }
const LS_SETTINGS = 'ftc-biobuzz-settings';   // { alliance, startPose, chassis, speed }
const LS_NAME = 'ftc-biobuzz-program-name';

// ---- cross-origin isolation check ------------------------------------------------
if (typeof SharedArrayBuffer === 'undefined' || !window.crossOriginIsolated) {
  const b = $('banner');
  b.hidden = false;
  b.innerHTML = 'This page needs <b>SharedArrayBuffer</b> (cross-origin isolation) to run OpModes. ' +
    'Start it with <code>node server.js</code> and open <code>http://127.0.0.1:8080/</code>, or serve it over HTTPS. ' +
    (location.protocol === 'file:' ? 'Opening index.html directly from disk will not work.' : 'If the page just registered its service worker, reload once.');
}

// ---- state ------------------------------------------------------------------------
const mem = createSharedMemory();
const views = viewsOf(mem);
initSharedDefaults(views);
let world = new World({ alliance: 'red', chassis: 'mecanum', startPose: 0 });
world.attachShared(views);
const renderer = new FieldRenderer($('field'), $('side'));
const input = new InputManager(views);
const editor = new Editor($('editor'));

const ds = {
  state: 'idle',           // idle | init | running | stopped | error
  opModes: [],
  worker: null,
  workerReady: false,
  current: null,
  stopTimer: null,
  match: { mode: 'practice', phase: 'idle', remaining: 0, teleopName: null },
};
let speed = 1;
let lastFrame = performance.now();
let accumulator = 0;
let lastRenderLog = 0;

// ---- worker ------------------------------------------------------------------------
function createWorker() {
  if (ds.worker) ds.worker.terminate();
  ds.workerReady = false;
  const w = new Worker(new URL('../sdk/worker.js', import.meta.url), { type: 'module' });
  w.onmessage = (ev) => onWorkerMessage(ev.data);
  w.onerror = (e) => { logLine(`Robot Controller error: ${e.message}`, 'err'); setDsState('error', e.message); };
  w.postMessage({ type: 'init', memory: mem });
  ds.worker = w;
  return w;
}

function onWorkerMessage(m) {
  switch (m.type) {
    case 'ready': ds.workerReady = true; if (pendingBuild) { const b = pendingBuild; pendingBuild = null; build(b.code, b.language); } break;
    case 'loaded': onLoaded(m); break;
    case 'telemetry': $('telemetry').textContent = m.lines.join('\n') || ' '; break;
    case 'log': logLine(m.text, m.level === 'error' ? 'err' : m.level === 'warn' ? 'warn' : ''); break;
    case 'state': setDsState('init', `${m.name} — INIT (press ▶ START)`); break;
    case 'done': onOpModeDone(m); break;
    case 'error': onOpModeError(m); break;
    default: break;
  }
}

let pendingBuild = null;
function build(code, language) {
  if (!ds.workerReady) { pendingBuild = { code, language }; createWorker(); return; }
  if (ds.state === 'init' || ds.state === 'running') stopOpMode(true);
  $('buildOutput').className = 'build-output';
  $('buildOutput').textContent = 'Building…';
  editor.markError(null);
  ds.worker.postMessage({ type: 'load', code, language });
}

function onLoaded(m) {
  ds.opModes = m.opModes;
  const sel = $('opModeSelect');
  sel.innerHTML = '';
  const enabled = m.opModes.filter((o) => !o.disabled);
  if (enabled.length === 0) {
    sel.innerHTML = '<option>— no OpModes found (add @TeleOp or @Autonomous) —</option>';
    $('buildOutput').className = 'build-output warn';
    $('buildOutput').textContent = 'Build OK, but no enabled OpModes were registered. Add @TeleOp(name="...") or @Autonomous(name="...") above the class.' +
      (m.warnings.length ? '\nWarnings:\n' + m.warnings.join('\n') : '');
    $('btnInit').disabled = true;
    return;
  }
  const groups = {};
  for (const o of enabled) (groups[o.group || ''] ||= []).push(o);
  for (const [g, list] of Object.entries(groups).sort()) {
    const og = document.createElement('optgroup');
    og.label = g || 'OpModes';
    for (const o of list) {
      const opt = document.createElement('option');
      opt.value = o.name; opt.textContent = `${o.type === 'Autonomous' ? '[A] ' : '[T] '}${o.name}`;
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }
  const tsel = $('teleopSelect');
  tsel.innerHTML = '';
  for (const o of enabled.filter((o) => o.type === 'TeleOp')) {
    const opt = document.createElement('option'); opt.value = o.name; opt.textContent = `TeleOp: ${o.name}`; tsel.appendChild(opt);
  }
  $('btnInit').disabled = false;
  $('buildOutput').className = 'build-output ' + (m.warnings.length ? 'warn' : 'ok');
  $('buildOutput').textContent = `Build OK: ${enabled.length} OpMode${enabled.length === 1 ? '' : 's'} (${enabled.map((o) => o.name).join(', ')})` +
    (m.warnings.length ? '\nWarnings:\n' + m.warnings.join('\n') : '');
  setDsState('idle', 'ready');
  logLine(`Built ${enabled.length} OpMode(s)`);
}

function onOpModeDone(m) {
  clearTimeout(ds.stopTimer);
  stopMotors();
  setDsState('stopped', `${m.name} stopped`);
  logLine(`OpMode "${m.name}" ended`);
  matchOnOpModeEnded(false, ds.userStopped);
  ds.userStopped = false;
}

function onOpModeError(m) {
  clearTimeout(ds.stopTimer);
  stopMotors();
  setDsState('error', 'error — see log');
  const line = extractLine(m.stack || '');
  logLine(`OpMode error: ${m.message}${line ? ` (line ${line})` : ''}`, 'err');
  if (m.stack) logLine(m.stack.split('\n').slice(0, 3).join(' | '), 'err');
  $('buildOutput').className = 'build-output err';
  $('buildOutput').textContent = `Runtime error${line ? ' at line ' + line : ''}: ${m.message}`;
  if (line) editor.markError(line);
  matchOnOpModeEnded(true, false);
  ds.userStopped = false;
}

function extractLine(stack) {
  const m = stack.match(/OpModes\.js:(\d+):\d+/);
  return m ? parseInt(m[1], 10) : null;
}

// ---- driver station ---------------------------------------------------------------
function setDsState(state, text) {
  ds.state = state;
  const el = $('dsStatus');
  el.textContent = text;
  el.className = 'ds-status ' + (state === 'running' ? 'running' : state === 'init' ? 'init' : state === 'error' ? 'error' : '');
  $('btnInit').disabled = !(state === 'idle' || state === 'stopped' || state === 'error') || ds.opModes.length === 0;
  $('btnStart').disabled = state !== 'init';
  $('btnStop').disabled = !(state === 'init' || state === 'running');
  $('opModeSelect').disabled = state === 'init' || state === 'running';
  $('field').style.cursor = (state === 'init' || state === 'running') ? 'default' : 'grab';
}

function resetHardwareCommands() {
  const { i32, f64 } = views;
  for (let i = 0; i < MAX_MOTORS; i++) {
    f64[F.MOTOR_POWER_BASE + i] = 0; f64[F.MOTOR_VELOCITY_BASE + i] = NaN;
    i32[I.MOTOR_MODE_BASE + i] = 0; i32[I.MOTOR_DIR_BASE + i] = 0; i32[I.MOTOR_ZPB_BASE + i] = 1; i32[I.MOTOR_TARGET_BASE + i] = 0;
  }
  for (let s = 0; s < MAX_SERVOS; s++) { f64[F.SERVO_POS_BASE + s] = 0; i32[I.SERVO_DIR_BASE + s] = 0; }
  i32[I.VISION_ENABLED] = 0;
}

function stopMotors() {
  const { f64, i32 } = views;
  for (let i = 0; i < MAX_MOTORS; i++) { f64[F.MOTOR_POWER_BASE + i] = 0; f64[F.MOTOR_VELOCITY_BASE + i] = NaN; i32[I.MOTOR_MODE_BASE + i] = 0; }
  i32[I.VISION_ENABLED] = 0;
}

function initOpMode(name) {
  if (!ds.workerReady) return;
  name = name || $('opModeSelect').value;
  if (!ds.opModes.find((o) => o.name === name)) return;
  resetHardwareCommands();
  Atomics.store(views.i32, I.STOP_REQUESTED, 0);
  Atomics.store(views.i32, I.STATE, OpModeState.IDLE);
  $('telemetry').textContent = ' ';
  ds.current = name;
  renderer.trail = [];
  world.robot.yawOffset = world.robot.heading * 180 / Math.PI;   // IMU yaw is zero at init
  ds.worker.postMessage({ type: 'run', name });
  setDsState('init', `${name} — initialising`);
  logLine(`INIT ${name}`);
}

function startOpMode() {
  if (ds.state !== 'init') return;
  Atomics.store(views.i32, I.STATE, OpModeState.RUNNING);
  Atomics.notify(views.i32, I.TICK);
  setDsState('running', `${ds.current} — RUNNING`);
  logLine(`START ${ds.current}`);
  matchOnStart();
}

function stopOpMode(silent = false) {
  if (!(ds.state === 'init' || ds.state === 'running')) return;
  Atomics.store(views.i32, I.STOP_REQUESTED, 1);
  Atomics.store(views.i32, I.STATE, OpModeState.STOPPED);
  Atomics.notify(views.i32, I.TICK);
  if (!silent) logLine(`STOP ${ds.current}`);
  ds.userStopped = !silent;
  setDsState('stopped', `${ds.current} — stopping…`);
  clearTimeout(ds.stopTimer);
  ds.stopTimer = setTimeout(() => {
    if (ds.state === 'stopped' && $('dsStatus').textContent.endsWith('stopping…')) {
      // The OpMode ignored the stop request (a loop without opModeIsActive()?): restart the Robot Controller.
      logLine('OpMode did not stop within 2 s (check that loops test opModeIsActive()). Restarting the Robot Controller…', 'warn');
      stopMotors();
      pendingBuild = { code: editor.value, language: $('language').value };
      createWorker();
      setDsState('stopped', 'robot restarted');
    }
  }, 2000);
}

// ---- match control ------------------------------------------------------------------
function matchOnStart() {
  const m = ds.match;
  m.mode = $('matchMode').value;
  const type = (ds.opModes.find((o) => o.name === ds.current) || {}).type;
  if (m.mode === 'practice') { m.phase = 'practice'; world.startPhase('practice'); return; }
  if (m.mode === 'auto' || (m.mode === 'full' && m.phase !== 'teleop')) {
    m.phase = 'auto'; m.remaining = MATCH.autoSeconds; world.startPhase('auto');
    if (type !== 'Autonomous') logLine('Note: an AUTO period was started with a TeleOp OpMode', 'warn');
  } else {
    m.phase = 'teleop'; m.remaining = MATCH.teleopSeconds; world.startPhase('teleop');
  }
}

function matchTick(dt) {
  const m = ds.match;
  if (m.phase === 'auto' || m.phase === 'teleop') {
    // the period clock keeps running even if the OpMode returned early (like a real match)
    m.remaining -= dt;
    if (m.remaining <= 0) {
      m.remaining = 0;
      world.endPhase();
      if (ds.state === 'init' || ds.state === 'running') stopOpMode(true);
      logLine(`${m.phase.toUpperCase()} period over`);
      if (m.phase === 'auto' && m.mode === 'full') {
        m.phase = 'transition'; m.remaining = MATCH.transitionSeconds;
        m.teleopName = $('teleopSelect').value;
        logLine(`AUTO over. TELEOP "${m.teleopName}" starts in ${MATCH.transitionSeconds} s`);
      } else {
        m.phase = 'finished'; world.phase = 'finished';
        const s = world.score();
        logLine(`MATCH OVER — red ${s.red.total} · blue ${s.blue.total}`);
      }
    }
  } else if (m.phase === 'transition') {
    m.remaining -= dt;
    if (m.remaining <= MATCH.transitionSeconds - 1.5 && ds.state !== 'init' && ds.state !== 'running' && !m.initDone) {
      m.initDone = true;
      $('opModeSelect').value = m.teleopName;
      initOpMode(m.teleopName);
    }
    if (m.remaining <= 0) {
      m.remaining = 0; m.initDone = false;
      m.phase = 'teleop';
      if (ds.state === 'init') { startOpMode(); } else { logLine('TeleOp OpMode was not ready at the end of the transition', 'warn'); m.phase = 'finished'; }
    }
  }
}

function matchOnOpModeEnded(errored, userStopped) {
  const m = ds.match;
  if ((m.phase === 'auto' || m.phase === 'teleop') && m.remaining > 0 && (errored || userStopped)) {
    // aborted by the driver or crashed: end the period now
    world.endPhase();
    if (m.phase === 'auto' && m.mode === 'full' && !errored) { m.phase = 'transition'; m.remaining = MATCH.transitionSeconds; m.teleopName = $('teleopSelect').value; }
    else { m.phase = 'finished'; world.phase = 'finished'; }
  }
}

function formatTimer() {
  const m = ds.match;
  let label = '';
  let t = m.remaining;
  if (m.phase === 'auto') label = 'AUTO ';
  else if (m.phase === 'teleop') label = 'TELEOP ';
  else if (m.phase === 'transition') label = 'next ';
  else if (m.phase === 'finished') { label = 'END '; t = 0; }
  else t = ds.state === 'running' ? world.phaseTime : 0;
  const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
  return `${label}${mm}:${String(ss).padStart(2, '0')}`;
}

// ---- main loop ------------------------------------------------------------------------
function frame(now) {
  const real = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  input.poll();
  accumulator += real * speed;
  let steps = 0;
  while (accumulator >= STEP && steps < 80) {
    world.step(STEP);
    matchTick(STEP);
    accumulator -= STEP; steps++;
  }
  if (steps === 80) accumulator = 0;
  renderer.draw(world, { distanceReading: views.f64[F.DISTANCE_IN] });
  $('timer').textContent = formatTimer();
  if (now - lastRenderLog > 250) { lastRenderLog = now; renderScore(); renderLog(); renderGamepad(); }
  requestAnimationFrame(frame);
}

function renderScore() {
  const s = world.score();
  const r = s.red, b = s.blue;
  const park = (x) => `${x.parkedAuto ? 'A' : '–'} ${x.parkedTeleop ? 'T' : '–'}`;
  const row = (label, rv, bv, cls = '') => `<tr class="${cls}"><th>${label}</th><td class="red">${rv}</td><td class="blue">${bv}</td></tr>`;
  $('score').innerHTML = `<table class="score-table">
    <thead><tr><th></th><th class="red">RED</th><th class="blue">BLUE</th></tr></thead>
    <tbody>
      ${row('Score', r.total, b.total, 'total')}
      ${row('HIVE TIPs <small>×20</small>', r.tips, b.tips)}
      ${row('In CELL <small>×2</small>', r.cellElements, b.cellElements)}
      ${row('FLOWER pts', r.flowerPoints, b.flowerPoints)}
      ${row('GARDEN <small>×1</small>', r.gardenElements, b.gardenElements)}
      ${row('LEAVE', r.left ? '✓' : '–', b.left ? '✓' : '–')}
      ${row('PARK <small>auto · tele</small>', park(r), park(b))}
    </tbody></table>`;
}

let logCount = 0;
const logEl = $('log');
function logLine(text, cls = '') {
  const div = document.createElement('div');
  div.className = cls;
  div.innerHTML = `<span class="t">${world.time.toFixed(1)}s</span> ${escapeHtml(text)}`;
  logEl.appendChild(div);
  while (logEl.children.length > 300) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}
let worldEventsSeen = 0;
function renderLog() {
  // pull new world events
  const ev = world.events;
  if (worldEventsSeen > ev.length) worldEventsSeen = 0;
  for (; worldEventsSeen < ev.length; worldEventsSeen++) {
    const e = ev[worldEventsSeen];
    const div = document.createElement('div');
    div.innerHTML = `<span class="t">${e.t.toFixed(1)}s</span> ${escapeHtml(e.text)}`;
    logEl.appendChild(div);
  }
  while (logEl.children.length > 300) logEl.removeChild(logEl.firstChild);
  if (logEl.children.length !== logCount) { logCount = logEl.children.length; logEl.scrollTop = logEl.scrollHeight; }
}
function renderGamepad() {
  const g = input.snapshot(1);
  const a = g.axes.map((v) => (v >= 0 ? ' ' : '') + v.toFixed(2));
  $('gpState').textContent = `L(${a[0]},${a[1]}) R(${a[2]},${a[3]}) LT ${a[4]} RT ${a[5]}  ${g.buttons.join(' ')}`;
}
function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

// ---- field interaction: drag the robot ------------------------------------------------
{
  const cv = $('field');
  let dragging = false;
  const canMove = () => !(ds.state === 'init' || ds.state === 'running');
  cv.addEventListener('pointerdown', (e) => {
    if (!canMove()) return;
    const r = cv.getBoundingClientRect();
    const [x, y] = renderer.toField(e.clientX - r.left, e.clientY - r.top);
    if (Math.hypot(x - world.robot.x, y - world.robot.y) < 16) { dragging = true; cv.setPointerCapture(e.pointerId); }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const r = cv.getBoundingClientRect();
    const [x, y] = renderer.toField(e.clientX - r.left, e.clientY - r.top);
    world.setRobotPose(Math.max(-63, Math.min(63, x)), Math.max(-63, Math.min(63, y)), world.robot.heading * 180 / Math.PI);
  });
  cv.addEventListener('pointerup', () => { dragging = false; });
  window.addEventListener('keydown', (e) => {
    if (!canMove() || input.isTypingTarget(e.target)) return;
    if (e.key === '[' || e.key === ']') {
      const d = e.key === '[' ? 15 : -15;
      world.setRobotPose(world.robot.x, world.robot.y, world.robot.heading * 180 / Math.PI + d);
    }
  });
}

// ---- controls ---------------------------------------------------------------------------
function fillStartPoses() {
  const sel = $('startPose');
  sel.innerHTML = '';
  START_POSES[$('alliance').value].forEach((p, i) => { const o = document.createElement('option'); o.value = i; o.textContent = p.name; sel.appendChild(o); });
}
function resetWorld() {
  if (ds.state === 'init' || ds.state === 'running') stopOpMode();
  world = new World({ alliance: $('alliance').value, chassis: $('chassis').value, startPose: Number($('startPose').value) });
  world.attachShared(views);
  renderer.trail = [];
  worldEventsSeen = 0;
  ds.match.phase = 'idle'; ds.match.remaining = 0;
  logEl.innerHTML = '';
  logLine(`Field reset: ${$('alliance').value} alliance, ${$('chassis').value} chassis`);
}
$('alliance').addEventListener('change', () => { fillStartPoses(); resetWorld(); });
$('startPose').addEventListener('change', resetWorld);
$('chassis').addEventListener('change', resetWorld);
$('resetField').addEventListener('click', resetWorld);
$('speed').addEventListener('change', (e) => { speed = Number(e.target.value); });
$('loadNectar').addEventListener('click', () => world.loadNectar());
$('matchMode').addEventListener('change', (e) => { $('teleopSelect').hidden = e.target.value !== 'full'; });
$('btnInit').addEventListener('click', () => initOpMode());
$('btnStart').addEventListener('click', startOpMode);
$('btnStop').addEventListener('click', () => stopOpMode());
$('btnBuild').addEventListener('click', () => build(editor.value, $('language').value));
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); build(editor.value, $('language').value); }
});

// tabs
for (const t of document.querySelectorAll('.tab')) {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    document.querySelectorAll('.tab-body').forEach((b) => { b.hidden = b.id !== 'tab-' + t.dataset.tab; });
  });
}

// editor persistence
let saveTimer = null;
editor.onChange = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(LS_CODE, editor.value); } catch (e) { /* ignore */ } }, 400); };
$('language').addEventListener('change', (e) => { try { localStorage.setItem(LS_LANG, e.target.value); } catch (err) { /* ignore */ } });

// ---- persistence: named programs, files, settings ----------------------------------------
function lsGet(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } }
function lsSet(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { logLine('Could not save to browser storage: ' + e.message, 'warn'); return false; } }

function classNameOf(code) {
  const m = code.match(/class\s+([A-Za-z_$][\w$]*)/);
  return m ? m[1] : null;
}
function refreshProgramList() {
  const programs = lsGet(LS_PROGRAMS, {});
  const sel = $('programList');
  const current = sel.value;
  sel.innerHTML = '<option value="">Saved programs…</option>';
  for (const name of Object.keys(programs).sort((a, b) => a.localeCompare(b))) {
    const o = document.createElement('option');
    const d = new Date(programs[name].savedAt);
    o.value = name; o.textContent = `${name}  (${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
    sel.appendChild(o);
  }
  if (current && programs[current]) sel.value = current;
}
function saveProgram() {
  let name = $('programName').value.trim() || classNameOf(editor.value) || '';
  if (!name) { name = prompt('Name for this program?') || ''; name = name.trim(); }
  if (!name) return;
  $('programName').value = name;
  const programs = lsGet(LS_PROGRAMS, {});
  programs[name] = { code: editor.value, language: $('language').value, savedAt: Date.now() };
  if (lsSet(LS_PROGRAMS, programs)) {
    lsSet(LS_NAME, name);
    refreshProgramList();
    $('programList').value = name;
    logLine(`Saved program "${name}" in this browser`);
  }
}
function loadProgram(name) {
  const programs = lsGet(LS_PROGRAMS, {});
  const p = programs[name];
  if (!p) return;
  editor.value = p.code;
  $('language').value = p.language || 'java';
  $('programName').value = name;
  lsSet(LS_NAME, name);
  editor.onChange();
  build(p.code, p.language || 'java');
  logLine(`Loaded program "${name}"`);
}
function deleteProgram() {
  const name = $('programList').value;
  if (!name) return;
  if (!confirm(`Delete saved program "${name}"?`)) return;
  const programs = lsGet(LS_PROGRAMS, {});
  delete programs[name];
  lsSet(LS_PROGRAMS, programs);
  refreshProgramList();
  logLine(`Deleted program "${name}"`);
}
function downloadProgram() {
  const lang = $('language').value;
  const name = ($('programName').value.trim() || classNameOf(editor.value) || 'OpMode').replace(/[^\w.-]+/g, '_');
  const blob = new Blob([editor.value], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.${lang === 'java' ? 'java' : 'js'}`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function openProgramFile(file) {
  if (!file) return;
  const text = await file.text();
  editor.value = text;
  const lang = file.name.endsWith('.js') ? 'javascript' : 'java';
  $('language').value = lang;
  $('programName').value = file.name.replace(/\.(java|js|txt)$/i, '');
  editor.onChange();
  build(text, lang);
  logLine(`Opened ${file.name}`);
}
function saveSettings() {
  lsSet(LS_SETTINGS, { alliance: $('alliance').value, startPose: $('startPose').value, chassis: $('chassis').value, speed: $('speed').value, matchMode: $('matchMode').value });
}
function restoreSettings() {
  const s = lsGet(LS_SETTINGS, null);
  if (!s) return;
  if (s.alliance) $('alliance').value = s.alliance;
  fillStartPoses();
  if (s.startPose) $('startPose').value = s.startPose;
  if (s.chassis) $('chassis').value = s.chassis;
  if (s.speed) { $('speed').value = s.speed; speed = Number(s.speed); }
  if (s.matchMode) { $('matchMode').value = s.matchMode; $('teleopSelect').hidden = s.matchMode !== 'full'; }
}
$('btnSave').addEventListener('click', saveProgram);
$('programList').addEventListener('change', (e) => { if (e.target.value) loadProgram(e.target.value); });
$('btnDeleteProgram').addEventListener('click', deleteProgram);
$('btnDownload').addEventListener('click', downloadProgram);
$('btnOpen').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', (e) => { openProgramFile(e.target.files[0]); e.target.value = ''; });
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveProgram(); }
});
for (const id of ['alliance', 'startPose', 'chassis', 'speed', 'matchMode']) $(id).addEventListener('change', saveSettings);

// samples
async function loadSamples() {
  try {
    const list = await (await fetch('samples/index.json')).json();
    const box = $('samples');
    for (const s of list) {
      const b = document.createElement('button');
      b.className = 'sample';
      b.innerHTML = `<b>${escapeHtml(s.title)}</b><span>${escapeHtml(s.description)}</span>`;
      b.addEventListener('click', async () => {
        const src = await (await fetch('samples/' + s.file)).text();
        editor.value = src;
        $('language').value = 'java';
        $('programName').value = '';
        lsSet(LS_NAME, '');
        editor.onChange();
        document.querySelector('.tab[data-tab="code"]').click();
        build(src, 'java');
      });
      box.appendChild(b);
    }
    return list;
  } catch (e) {
    $('samples').textContent = 'Samples could not be loaded: ' + e.message;
    return [];
  }
}

function renderRobotConfig() {
  const rows = (arr) => arr.join('');
  const html = `
  <p>This is the robot's <b>hardware configuration</b>, as it would appear in the Robot Controller app. Use these names with <code>hardwareMap.get(Type.class, "name")</code>.</p>
  <table><tr><th>Motor name</th><th>Hub / port</th><th>Motor</th><th>Encoder ticks / rev</th><th>Drives</th></tr>
  ${rows(MOTORS.map((m) => `<tr><td><code>${m.name}</code>${m.aliases ? '<br><small>' + m.aliases.map((a) => `<code>${a}</code>`).join(' ') + '</small>' : ''}</td><td>${m.hub} motor ${m.port}</td><td>${MOTOR_TYPES[m.type].name} (${MOTOR_TYPES[m.type].freeRpm} rpm)</td><td>${MOTOR_TYPES[m.type].ticksPerRev}</td><td>${m.role === 'drive' ? m.wheel + ' wheel' : m.role}</td></tr>`))}
  </table>
  <p><small>Tank-style names ${Object.keys(MOTOR_GANGS).slice(0, 2).map((k) => `<code>${k}</code>`).join(', ')} drive both wheels on that side. Left-side motors face the other way: set them to <code>DcMotor.Direction.REVERSE</code>.</small></p>
  <table><tr><th>Servo name</th><th>Hub / port</th><th>Type</th><th>What it does</th></tr>
  ${rows(SERVOS.map((s) => `<tr><td><code>${s.name}</code></td><td>${s.hub} servo ${s.port}</td><td>${s.kind === 'crservo' ? 'CRServo' : 'Servo'}</td><td>${s.description}</td></tr>`))}
  </table>
  <table><tr><th>Sensor name</th><th>Type (hardwareMap class)</th><th>Hub / port</th><th>Notes</th></tr>
  ${rows(SENSORS.map((s) => `<tr><td><code>${s.name}</code>${s.aliases ? '<br><small>' + s.aliases.map((a) => `<code>${a}</code>`).join(' ') + '</small>' : ''}</td><td>${s.type}</td><td>${s.hub} ${s.port}</td><td>${s.description}</td></tr>`))}
  </table>
  <p><b>Chassis:</b> ${ROBOT_BODY.length} × ${ROBOT_BODY.width} × ${ROBOT_BODY.height} in, ${ROBOT_BODY.wheelDiameterIn.toFixed(2)} in wheels, track ${ROBOT_BODY.trackWidthIn} in, wheelbase ${ROBOT_BODY.wheelBaseIn} in.
  Intake holds ${ROBOT_BODY.intake.capacity} elements (the possession limit). Launcher: ${ROBOT_BODY.launcher.wheelDiameterMm} mm wheel, exit ${ROBOT_BODY.launcher.exitHeightIn} in above the tiles, needs ≥ ${ROBOT_BODY.launcher.minWheelRpmToFire} rpm to launch; the <code>feeder</code> servo fires one ball each time it moves from below ${ROBOT_BODY.launcher.feederFirePosition} to above it.</p>`;
  $('robotConfig').innerHTML = html;
}

// ---- boot ---------------------------------------------------------------------------------
async function boot() {
  fillStartPoses();
  restoreSettings();
  renderRobotConfig();
  refreshProgramList();
  input.onChange = (st) => { $('gp1').textContent = st[1]; $('gp2').textContent = st[2]; };
  input.updateStatus();
  createWorker();
  setDsState('idle', 'no OpMode loaded');
  const samples = await loadSamples();
  let code = null, lang = 'java';
  try { code = localStorage.getItem(LS_CODE); lang = localStorage.getItem(LS_LANG) || 'java'; } catch (e) { /* ignore */ }
  if (!code && samples.length) code = await (await fetch('samples/' + samples[0].file)).text();
  editor.value = code || '';
  $('language').value = lang;
  $('programName').value = lsGet(LS_NAME, '') || '';
  if (code) build(code, lang);
  logLine('Simulator ready. Pick a sample or write an OpMode, press Build, then INIT and START.');
  requestAnimationFrame(frame);
}
boot();
