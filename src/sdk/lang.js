// Java standard-library look-alikes so OpModes written for OnBot Java run
// unchanged after translation: String.format, Math.toRadians, ElapsedTime,
// Range, ArrayList, System.out.println ...
//
// Everything here is exported as a plain object of "globals" that the worker
// injects into the scope the student's OpMode is evaluated in.

export function installJavaGlobals(target = globalThis) {
  // ---- Math ----------------------------------------------------------------
  const M = target.Math;
  if (!M.toRadians) M.toRadians = (d) => d * Math.PI / 180;
  if (!M.toDegrees) M.toDegrees = (r) => r * 180 / Math.PI;
  if (!M.signum) M.signum = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);
  // Java's Math.round rounds half up (toward +inf) and returns an integer.
  M.round = (x) => Math.floor(x + 0.5);

  // Lambdas become plain functions; let them answer to the common Java functional-interface methods.
  for (const m of ['run', 'accept', 'get', 'test', 'applyAsDouble', 'applyAsInt', 'applyAsLong', 'compare', 'value', 'onEvent']) {
    if (!Object.prototype.hasOwnProperty.call(target.Function.prototype, m)) {
      Object.defineProperty(target.Function.prototype, m, { value(...a) { return this(...a); }, configurable: true, writable: true });
    }
  }

  // ---- String.format --------------------------------------------------------
  target.String.format = javaFormat;
  target.String.valueOf = (x) => (x === null || x === undefined ? 'null' : String(x));
  target.String.join = (sep, ...parts) => (parts.length === 1 && Array.isArray(parts[0]) ? parts[0] : parts).join(sep);
  Object.defineProperty(target.String.prototype, 'equals', {
    value(other) { return this.valueOf() === (other && other.valueOf ? other.valueOf() : other); },
    configurable: true, writable: true,
  });
  Object.defineProperty(target.String.prototype, 'equalsIgnoreCase', {
    value(other) { return String(this).toLowerCase() === String(other).toLowerCase(); },
    configurable: true, writable: true,
  });
  Object.defineProperty(target.String.prototype, 'length_', { get() { return this.length; }, configurable: true });
  Object.defineProperty(target.String.prototype, 'isEmpty', { value() { return this.length === 0; }, configurable: true, writable: true });
  Object.defineProperty(target.String.prototype, 'contains', { value(s) { return this.includes(s); }, configurable: true, writable: true });
  Object.defineProperty(target.String.prototype, 'charAt_', { value(i) { return this.charAt(i); }, configurable: true, writable: true });

  Object.defineProperty(target.Number.prototype, 'equals', {
    value(other) { return this.valueOf() === Number(other); }, configurable: true, writable: true,
  });
  Object.defineProperty(target.Boolean.prototype, 'equals', {
    value(other) { return this.valueOf() === Boolean(other); }, configurable: true, writable: true,
  });
  Object.defineProperty(target.Object.prototype, 'equals', {
    value(other) { return this === other; }, configurable: true, writable: true,
  });

  return {
    Integer: {
      MAX_VALUE: 2147483647, MIN_VALUE: -2147483648,
      parseInt: (s) => parseInt(s, 10), valueOf: (x) => Number(x), toString: (x) => String(Math.trunc(x)),
      compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0), signum: (x) => Math.sign(x),
    },
    Double: {
      MAX_VALUE: Number.MAX_VALUE, MIN_VALUE: Number.MIN_VALUE, POSITIVE_INFINITY: Infinity, NEGATIVE_INFINITY: -Infinity, NaN: NaN,
      parseDouble: (s) => parseFloat(s), valueOf: (x) => Number(x), toString: (x) => String(x),
      isNaN: (x) => Number.isNaN(x), isInfinite: (x) => x === Infinity || x === -Infinity,
      compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
    },
    Float: { parseFloat: (s) => parseFloat(s), MAX_VALUE: 3.4028235e38 },
    Long: { MAX_VALUE: Number.MAX_SAFE_INTEGER, parseLong: (s) => parseInt(s, 10), toString: (x) => String(Math.trunc(x)) },
    Boolean: { parseBoolean: (s) => String(s).toLowerCase() === 'true', toString: (b) => String(!!b), TRUE: true, FALSE: false },
    Character: { isDigit: (c) => /[0-9]/.test(c), isLetter: (c) => /[a-zA-Z]/.test(c), toUpperCase: (c) => c.toUpperCase() },
    System: {
      out: { println: (...a) => log('info', a.join(' ')), print: (...a) => log('info', a.join(' ')), printf: (f, ...a) => log('info', javaFormat(f, ...a)) },
      err: { println: (...a) => log('error', a.join(' ')) },
      currentTimeMillis: () => Date.now(),
      nanoTime: () => Math.round(performance.now() * 1e6),
    },
    Thread: { sleep: (ms) => { if (target.__ftcSleep) target.__ftcSleep(ms); }, currentThread: () => ({ interrupt() {}, isInterrupted: () => false }) },
    Objects: { equals: (a, b) => a === b || (a && a.equals && a.equals(b)), requireNonNull: (x) => x, toString: (x) => String(x) },
    Arrays: {
      asList: (...a) => new ArrayList(a.length === 1 && Array.isArray(a[0]) ? a[0] : a),
      toString: (a) => '[' + a.join(', ') + ']', fill: (a, v) => a.fill(v), copyOf: (a, n) => { const r = a.slice(0, n); while (r.length < n) r.push(0); return r; },
      sort: (a) => a.sort((x, y) => x - y),
    },
    ArrayList, List: ArrayList, LinkedList: ArrayList, HashMap, Map: HashMap, Collections: { sort: (l) => l.sort() },
    ElapsedTime, Range, Deadline: ElapsedTime,
    StringBuilder,
    RuntimeException: Error, Exception: Error, InterruptedException: Error, IllegalArgumentException: Error, IllegalStateException: Error,
    Override: () => {}, // annotations become no-ops if they survive translation
  };
}

function log(level, text) {
  if (globalThis.__ftcLog) globalThis.__ftcLog(level, text);
  else console.log(text);
}

// ---- java.util.Formatter subset ----------------------------------------------
export function javaFormat(fmt, ...args) {
  let i = 0;
  return String(fmt).replace(/%(\d+\$)?([-+ 0,#(]*)(\d+)?(\.\d+)?([a-zA-Z%])/g, (m, argIdx, flags, width, prec, conv) => {
    if (conv === '%') return '%';
    if (conv === 'n') return '\n';
    let arg = argIdx ? args[parseInt(argIdx, 10) - 1] : args[i++];
    let s;
    switch (conv) {
      case 'd': {
        const n = Math.trunc(Number(arg));
        s = Math.abs(n).toString();
        if (flags.includes(',')) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        if (n < 0) s = '-' + s; else if (flags.includes('+')) s = '+' + s; else if (flags.includes(' ')) s = ' ' + s;
        break;
      }
      case 'f': {
        const p = prec ? parseInt(prec.slice(1), 10) : 6;
        const n = Number(arg);
        s = Math.abs(n).toFixed(p);
        if (flags.includes(',')) { const [a, b] = s.split('.'); s = a.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (b ? '.' + b : ''); }
        if (n < 0 || (Object.is(n, -0))) s = '-' + s; else if (flags.includes('+')) s = '+' + s; else if (flags.includes(' ')) s = ' ' + s;
        break;
      }
      case 'e': case 'E': {
        const p = prec ? parseInt(prec.slice(1), 10) : 6;
        s = Number(arg).toExponential(p).replace(/e([+-])(\d)$/, 'e$10$2');
        if (conv === 'E') s = s.toUpperCase();
        break;
      }
      case 'g': case 'G': {
        const p = prec ? parseInt(prec.slice(1), 10) : 6;
        s = Number(arg).toPrecision(p);
        break;
      }
      case 'x': s = (Math.trunc(Number(arg)) >>> 0).toString(16); break;
      case 'X': s = (Math.trunc(Number(arg)) >>> 0).toString(16).toUpperCase(); break;
      case 'o': s = (Math.trunc(Number(arg)) >>> 0).toString(8); break;
      case 'b': case 'B': s = String(!!arg && arg !== 'false'); break;
      case 'c': s = typeof arg === 'number' ? String.fromCharCode(arg) : String(arg); break;
      case 's': case 'S': s = arg === undefined ? 'null' : String(arg); if (prec) s = s.slice(0, parseInt(prec.slice(1), 10)); if (conv === 'S') s = s.toUpperCase(); break;
      default: s = String(arg);
    }
    if (width) {
      const w = parseInt(width, 10);
      if (s.length < w) {
        if (flags.includes('-')) s = s.padEnd(w);
        else if (flags.includes('0') && /[dfeExXo]/.test(conv)) {
          const sign = /^[-+ ]/.test(s) ? s[0] : '';
          s = sign + s.slice(sign.length).padStart(w - sign.length, '0');
        } else s = s.padStart(w);
      }
    }
    return s;
  });
}

// ---- com.qualcomm.robotcore.util -------------------------------------------
export class ElapsedTime {
  static Resolution = Object.freeze({ SECONDS: 'SECONDS', MILLISECONDS: 'MILLISECONDS' });
  constructor(arg) {
    this.resolution = arg === ElapsedTime.Resolution.MILLISECONDS ? 1000 : 1;
    this.startTime = ElapsedTime.now() - (typeof arg === 'number' ? arg / 1e9 : 0);
  }
  static now() { return globalThis.__ftcClock ? globalThis.__ftcClock() : performance.now() / 1000; }
  reset() { this.startTime = ElapsedTime.now(); }
  startTimeNanoseconds() { return this.startTime * 1e9; }
  time(unit) {
    const s = ElapsedTime.now() - this.startTime;
    if (unit) return s * unitScale(unit);
    return s * this.resolution;
  }
  seconds() { return ElapsedTime.now() - this.startTime; }
  milliseconds() { return this.seconds() * 1000; }
  nanoseconds() { return this.seconds() * 1e9; }
  now(unit) { return ElapsedTime.now() * (unit ? unitScale(unit) : 1e9); }
  toString() {
    const s = this.seconds();
    if (this.resolution === 1000) return `${(s * 1000).toFixed(0)}ms`;
    return `${s.toFixed(3)}s`;
  }
  log(label) { log('info', `TIMER: ${label} - ${this.toString()}`); }
}
function unitScale(unit) {
  const u = typeof unit === 'string' ? unit : unit && unit.name;
  switch (u) {
    case 'NANOSECONDS': return 1e9; case 'MICROSECONDS': return 1e6; case 'MILLISECONDS': return 1e3;
    case 'SECONDS': return 1; case 'MINUTES': return 1 / 60; default: return 1;
  }
}

export const Range = Object.freeze({
  clip(x, min, max) { return x < min ? min : x > max ? max : x; },
  scale(n, x1, x2, y1, y2) { return (n - x1) / (x2 - x1) * (y2 - y1) + y1; },
  throwIfRangeIsInvalid(x, min, max) { if (x < min || x > max) throw new Error(`number ${x} is invalid; valid ranges are ${min}..${max}`); },
});

export class ArrayList extends Array {
  constructor(init) { super(); if (Array.isArray(init)) this.push(...init); else if (init && typeof init[Symbol.iterator] === 'function') this.push(...init); }
  static get [Symbol.species]() { return Array; }
  add(a, b) { if (b === undefined) { this.push(a); return true; } this.splice(a, 0, b); return true; }
  get(i) { return this[i]; }
  set(i, v) { const o = this[i]; this[i] = v; return o; }
  size() { return this.length; }
  isEmpty() { return this.length === 0; }
  clear() { this.length = 0; }
  remove(i) { if (typeof i === 'number') return this.splice(i, 1)[0]; const k = this.indexOf(i); if (k >= 0) this.splice(k, 1); return k >= 0; }
  contains(v) { return this.includes(v); }
  addAll(list) { this.push(...list); return true; }
  toArray() { return Array.from(this); }
  stream() { return this; }
}

export class HashMap extends Map {
  put(k, v) { const o = this.get(k); this.set(k, v); return o; }
  containsKey(k) { return this.has(k); }
  remove(k) { const o = this.get(k); this.delete(k); return o; }
  isEmpty() { return this.size === 0; }
  keySet() { return Array.from(this.keys()); }
  getOrDefault(k, d) { return this.has(k) ? this.get(k) : d; }
}

export class StringBuilder {
  constructor(s = '') { this.s = String(s); }
  append(x) { this.s += String(x); return this; }
  toString() { return this.s; }
  length() { return this.s.length; }
  setLength(n) { this.s = this.s.slice(0, n); }
}
