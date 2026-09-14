// Web Worker entry point: the "Robot Controller" that runs OpModes.
//
// Messages from the main thread:
//   {type:'init', memory}                    attach shared memory
//   {type:'load', code, language}            evaluate translated OpMode source, reply with the OpMode list
//   {type:'run', name}                       run the named OpMode (blocks this worker until it ends)
// Messages to the main thread:
//   {type:'ready'} {type:'loaded', opModes} {type:'telemetry', lines} {type:'log', level, text}
//   {type:'state', state} {type:'error', message, stack} {type:'done', name}
import { viewsOf, I, OpModeState } from '../sim/shared-memory.js';
import { installJavaGlobals } from './lang.js';
import * as HW from './hardware.js';
import { runtime, OpMode, LinearOpMode, Telemetry, runOpModeInstance, OpModeStoppedException } from './opmode.js';
import { translateJava } from './java2js.js';

// Runs both as a browser Web Worker and as a Node worker_thread (for tests).
const isNode = typeof self === 'undefined';
let post;
if (isNode) {
  const { parentPort } = await import('node:worker_threads');
  post = (msg) => parentPort.postMessage(msg);
  parentPort.on('message', (data) => handleMessage(data));
} else {
  post = (msg) => self.postMessage(msg);
  self.onmessage = (ev) => handleMessage(ev.data);
}

const javaGlobals = installJavaGlobals(globalThis);
globalThis.__ftcLog = (level, text) => post({ type: 'log', level, text: String(text) });
globalThis.__ftcClock = () => (runtime.views ? runtime.simTime() : performance.now() / 1000);
globalThis.__ftcSleep = (ms) => runtime.sleep(ms);

/** Registry filled by @TeleOp / @Autonomous annotations. */
const registry = [];
const OpModeRegistrar = {
  register(meta, ctor) {
    registry.push({ ...meta, ctor });
    return ctor;
  },
};

function sdkScope() {
  return {
    ...javaGlobals,
    ...HW,
    OpMode, LinearOpMode, Telemetry, OpModeStoppedException,
    TeleOp: (m) => (ctor) => OpModeRegistrar.register({ ...m, type: 'TeleOp' }, ctor),
    Autonomous: (m) => (ctor) => OpModeRegistrar.register({ ...m, type: 'Autonomous' }, ctor),
    Disabled: () => (ctor) => ctor,
    __registerOpMode: (meta, ctor) => OpModeRegistrar.register(meta, ctor),
    __log: globalThis.__ftcLog,
    console: { log: (...a) => globalThis.__ftcLog('info', a.join(' ')), error: (...a) => globalThis.__ftcLog('error', a.join(' ')), warn: (...a) => globalThis.__ftcLog('warn', a.join(' ')) },
  };
}

/** `new Function(args, body)` puts the body on line 3, so stack lines are Java line + 2. */
function fixStack(stack) {
  return String(stack || '').replace(/OpModes\.js:(\d+)/g, (m, n) => `OpModes.js:${Math.max(1, parseInt(n, 10) - 2)}`);
}

function handleMessage(msg) {
  try {
    switch (msg.type) {
      case 'init': {
        runtime.views = viewsOf(msg.memory);
        runtime.telemetryOut = (lines) => post({ type: 'telemetry', lines });
        runtime.log = globalThis.__ftcLog;
        post({ type: 'ready' });
        break;
      }
      case 'load': {
        registry.length = 0;
        let js = msg.code;
        let translation = null;
        if (msg.language === 'java') {
          translation = translateJava(msg.code);
          js = translation.code;
        }
        const scope = sdkScope();
        const names = Object.keys(scope);
        // Sloppy-mode evaluation so translated Java may use `with (this)`.
        const fn = new Function(...names, js + '\n//# sourceURL=OpModes.js');
        fn(...names.map((n) => scope[n]));
        post({
          type: 'loaded',
          opModes: registry.map((r) => ({ name: r.name, group: r.group || '', type: r.type, disabled: !!r.disabled, kind: r.kind })),
          translated: translation ? translation.code : null,
          warnings: translation ? translation.warnings : [],
        });
        break;
      }
      case 'run': {
        const entry = registry.find((r) => r.name === msg.name);
        if (!entry) { post({ type: 'error', message: `No OpMode named "${msg.name}"` }); break; }
        const i32 = runtime.views.i32;
        Atomics.store(i32, I.STOP_REQUESTED, 0);
        let op;
        try {
          op = new entry.ctor();
        } catch (e) {
          post({ type: 'error', message: `Error constructing OpMode "${entry.name}": ${e.message}`, stack: fixStack(e.stack) });
          Atomics.store(i32, I.STATE, OpModeState.ERROR);
          break;
        }
        const kind = entry.kind || (op instanceof LinearOpMode ? 'linear' : 'iterative');
        post({ type: 'state', state: 'init', name: entry.name });
        const result = runOpModeInstance(op, kind);
        if (result.ok) {
          Atomics.store(i32, I.STATE, OpModeState.STOPPED);
          post({ type: 'done', name: entry.name, stopped: !!result.stopped });
        } else {
          Atomics.store(i32, I.STATE, OpModeState.ERROR);
          const e = result.error;
          post({ type: 'error', message: `${e.name || 'Error'}: ${e.message}`, stack: fixStack(e.stack), name: entry.name });
        }
        break;
      }
      default:
        break;
    }
  } catch (e) {
    post({ type: 'error', message: e.message, stack: fixStack(e.stack) });
    if (runtime.views) Atomics.store(runtime.views.i32, I.STATE, OpModeState.ERROR);
  }
}
