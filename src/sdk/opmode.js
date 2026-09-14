// OpMode base classes and the runtime that executes them inside the worker.
//
// LinearOpMode.runOpMode() runs on the worker thread and BLOCKS just like on a
// real Control Hub: waitForStart() and sleep() park the thread with
// Atomics.wait() until the simulator ticks the shared clock. STOP is a flag in
// shared memory, polled by opModeIsActive() / isStopRequested() / sleep().
//
// The base classes are written as plain constructor functions (not `class`)
// so translated Java code can call them with .call(this) from sloppy-mode
// functions that use `with (this)` for Java's implicit field access.
import { I, F, OpModeState } from '../sim/shared-memory.js';
import { HardwareMap, Gamepad } from './hardware.js';

export class OpModeStoppedException extends Error {
  constructor(msg = 'OpMode stopped') { super(msg); this.name = 'OpModeStoppedException'; }
}

/** Shared state for the currently running OpMode (one per worker). */
export const runtime = {
  views: null,
  telemetryOut: null,      // function(lines)
  log: null,               // function(level, text)
  startRealTime: 0,
  opModeStartSimTime: 0,
  stopRequested() { return Atomics.load(this.views.i32, I.STOP_REQUESTED) === 1; },
  state() { return Atomics.load(this.views.i32, I.STATE); },
  simTime() { return this.views.f64[F.TIME_S]; },
  /** Block until the simulator advances one physics step (or stop is requested). */
  waitTick(maxMs = 50) {
    const i32 = this.views.i32;
    const tick = Atomics.load(i32, I.TICK);
    Atomics.wait(i32, I.TICK, tick, maxMs);
    Atomics.add(i32, I.WATCHDOG, 1);
  },
  /** Block for `ms` of simulated time. Returns early when STOP is pressed. */
  sleep(ms) {
    if (this.stopRequested()) return;
    const target = this.simTime() + ms / 1000;
    while (this.simTime() < target) {
      if (this.stopRequested()) return;
      this.waitTick(50);
    }
  },
};

// ---- Telemetry ---------------------------------------------------------------------
export class Telemetry {
  static DisplayFormat = Object.freeze({ CLASSIC: 'CLASSIC', MONOSPACE: 'MONOSPACE', HTML: 'HTML' });
  constructor() {
    this._lines = [];
    this._retained = [];
    this._autoClear = true;
    this._lastSent = -Infinity;
    this._intervalMs = 50;
    this._captionValueSeparator = ' : ';
    this._itemSeparator = ' | ';
    this._dirty = false;
    this._logLines = [];
    this._displayFormat = Telemetry.DisplayFormat.CLASSIC;
    this.log = () => ({
      add: (fmt, ...args) => { this._logLines.push(fmtStr(fmt, args)); if (this._logLines.length > 9) this._logLines.shift(); this._dirty = true; },
      clear: () => { this._logLines = []; },
      setCapacity: () => {}, getCapacity: () => 9, setDisplayOrder: () => {},
    });
  }
  addData(caption, value, ...args) {
    let text;
    if (typeof value === 'function') text = String(value());
    else if (typeof value === 'string' && args.length > 0) text = fmtStr(value, args);
    else text = valueToString(value);
    const item = { caption: String(caption), value: text, retained: false, isLine: false };
    this._lines.push(item);
    this._dirty = true;
    return itemHandle(this, item, value, args);
  }
  addLine(text = '') {
    const item = { caption: String(text), value: null, retained: false, isLine: true };
    this._lines.push(item);
    this._dirty = true;
    return { addData: (c, v, ...a) => { this.addData(c, v, ...a); return this; } };
  }
  update() {
    // throttle on simulated time so behaviour does not depend on how fast the host runs
    const now = runtime.views ? runtime.simTime() * 1000 : performance.now();
    const lines = [...this._retained, ...this._lines].map((it) => (it.isLine ? it.caption : `${it.caption}${this._captionValueSeparator}${it.value}`));
    if (this._logLines.length) lines.push(...this._logLines.map((l) => `> ${l}`));
    if (runtime.telemetryOut && (now - this._lastSent >= this._intervalMs || !this._autoClear)) {
      runtime.telemetryOut(lines);
      this._lastSent = now;
      this._pending = null;
    } else if (runtime.telemetryOut) {
      // keep the newest content ready so the final update is never lost
      this._pending = lines;
    }
    if (this._autoClear) this._lines = [];
    this._dirty = false;
    return true;
  }
  flush() { if (this._pending && runtime.telemetryOut) { runtime.telemetryOut(this._pending); this._pending = null; } }
  clear() { this._lines = []; }
  clearAll() { this._lines = []; this._retained = []; this._logLines = []; }
  setAutoClear(b) { this._autoClear = b; }
  isAutoClear() { return this._autoClear; }
  setMsTransmissionInterval(ms) { this._intervalMs = Math.max(10, ms); }
  getMsTransmissionInterval() { return this._intervalMs; }
  setCaptionValueSeparator(s) { this._captionValueSeparator = s; }
  setItemSeparator(s) { this._itemSeparator = s; }
  setDisplayFormat(f) { this._displayFormat = f; }
  addAction() { return {}; }
  removeAction() { return true; }
  removeItem() { return true; }
  removeLine() { return true; }
  speak() {}
}
function itemHandle(t, item, value, args) {
  const h = {
    setRetained(r) { item.retained = !!r; if (r) { t._retained.push(item); const k = t._lines.indexOf(item); if (k >= 0) t._lines.splice(k, 1); } return h; },
    isRetained() { return item.retained; },
    setValue(v, ...a) { item.value = typeof v === 'string' && a.length ? fmtStr(v, a) : valueToString(v); return h; },
    setCaption(c) { item.caption = String(c); return h; },
    getCaption() { return item.caption; },
    addData(c, v, ...a) { return t.addData(c, v, ...a); },
  };
  return h;
}
function fmtStr(fmt, args) { return String.format ? String.format(fmt, ...args) : String(fmt); }
function valueToString(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object' && v.name && v.ordinal !== undefined) return v.name; // enum
  return String(v);
}

// ---- OpMode base (iterative) --------------------------------------------------------
export function OpMode() {
  this.hardwareMap = new HardwareMap(runtime.views);
  this.gamepad1 = new Gamepad(runtime.views, 1);
  this.gamepad2 = new Gamepad(runtime.views, 2);
  this.telemetry = new Telemetry();
  this.time = 0;
  this.msStuckDetectInit = 5000; this.msStuckDetectInitLoop = 5000; this.msStuckDetectStart = 5000; this.msStuckDetectLoop = 5000; this.msStuckDetectStop = 900;
  this._startTime = runtime.simTime();
}
OpMode.prototype.init = function () {};
OpMode.prototype.init_loop = function () {};
OpMode.prototype.start = function () {};
OpMode.prototype.loop = function () { throw new Error('OpMode.loop() must be overridden'); };
OpMode.prototype.stop = function () {};
OpMode.prototype.getRuntime = function () { return runtime.simTime() - this._startTime; };
OpMode.prototype.resetRuntime = function () { this._startTime = runtime.simTime(); };
OpMode.prototype.requestOpModeStop = function () { Atomics.store(runtime.views.i32, I.STOP_REQUESTED, 1); };
OpMode.prototype.terminateOpModeNow = function () { throw new OpModeStoppedException('terminateOpModeNow()'); };
OpMode.prototype.updateTelemetry = function (t) { t.update(); };
OpMode.prototype.internalPreInit = function () {};
OpMode.prototype.internalPostInitLoop = function () {};
OpMode.prototype.internalPostLoop = function () {};

// ---- LinearOpMode -------------------------------------------------------------------
export function LinearOpMode() {
  OpMode.call(this);
  this._started = false;
}
LinearOpMode.prototype = Object.create(OpMode.prototype);
LinearOpMode.prototype.constructor = LinearOpMode;
LinearOpMode.prototype.runOpMode = function () { throw new Error('runOpMode() must be overridden'); };
LinearOpMode.prototype.waitForStart = function () {
  while (!this.isStarted()) {
    if (runtime.stopRequested()) throw new OpModeStoppedException();
    this.telemetry.flush();
    runtime.waitTick(50);
  }
  this.resetRuntime();
};
LinearOpMode.prototype.isStarted = function () {
  const s = runtime.state();
  return s === OpModeState.RUNNING || runtime.stopRequested();
};
LinearOpMode.prototype.isStopRequested = function () { return runtime.stopRequested(); };
LinearOpMode.prototype.opModeIsActive = function () {
  const active = this.isStarted() && !runtime.stopRequested();
  if (active) this.idle();
  return active;
};
LinearOpMode.prototype.opModeInInit = function () { return !this.isStarted() && !runtime.stopRequested(); };
LinearOpMode.prototype.idle = function () { runtime.waitTick(20); };
LinearOpMode.prototype.sleep = function (ms) { runtime.sleep(ms); };
LinearOpMode.prototype.handleLoop = function () { this.idle(); };
LinearOpMode.prototype.init = function () {};   // the iterative hooks are not used by LinearOpMode
LinearOpMode.prototype.loop = function () {};

// ---- runner -------------------------------------------------------------------------
/** Execute one OpMode instance to completion. Returns when it finishes or STOP is pressed. */
export function runOpModeInstance(op, kind) {
  const i32 = runtime.views.i32;
  const finish = () => { try { op.telemetry.flush(); } catch (e) { /* ignore */ } };
  try {
    if (kind === 'linear') {
      Atomics.store(i32, I.STATE, OpModeState.INIT);
      op.runOpMode();
    } else {
      Atomics.store(i32, I.STATE, OpModeState.INIT);
      op.init();
      op.telemetry.update();
      while (runtime.state() === OpModeState.INIT && !runtime.stopRequested()) {
        op.init_loop();
        op.telemetry.update();
        runtime.waitTick(20);
      }
      if (!runtime.stopRequested()) {
        op.resetRuntime();
        op.start();
        while (!runtime.stopRequested()) {
          op.time = op.getRuntime();
          op.loop();
          op.telemetry.update();
          runtime.waitTick(20);
        }
      }
      op.stop();
      op.telemetry.update();
    }
    finish();
    return { ok: true };
  } catch (e) {
    finish();
    if (e instanceof OpModeStoppedException) return { ok: true, stopped: true };
    return { ok: false, error: e };
  }
}
