import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { translateJava } from '../src/sdk/java2js.js';
import { installJavaGlobals, javaFormat } from '../src/sdk/lang.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const samplesDir = path.join(here, '..', 'samples');

/** Evaluate translated code with a minimal fake SDK scope and return the registered classes. */
function load(js, extraScope = {}) {
  const registry = [];
  function OpMode() { this.telemetry = { lines: [], addData(c, v) { this.lines.push(`${c}=${v}`); }, update() {} }; this.hardwareMap = { get: (t, n) => ({ name: n, setPower() {}, setDirection() {} }) }; this.gamepad1 = {}; this.gamepad2 = {}; }
  function LinearOpMode() { OpMode.call(this); }
  LinearOpMode.prototype = Object.create(OpMode.prototype);
  LinearOpMode.prototype.sleep = function () {};
  LinearOpMode.prototype.opModeIsActive = function () { return false; };
  LinearOpMode.prototype.waitForStart = function () {};
  const globals = installJavaGlobals(globalThis);
  const scope = { ...globals, OpMode, LinearOpMode, __registerOpMode: (meta, ctor) => registry.push({ ...meta, ctor }),
    DcMotor: Object.assign(function DcMotor() {}, { Direction: { FORWARD: 'F', REVERSE: 'R' }, RunMode: {} }), Servo: function Servo() {}, ...extraScope };
  const names = Object.keys(scope);
  new Function(...names, js)(...names.map((n) => scope[n]));
  return registry;
}

test('every bundled sample translates to valid JavaScript with no warnings', () => {
  const files = fs.readdirSync(samplesDir).filter((f) => f.endsWith('.java'));
  assert.ok(files.length >= 9);
  for (const f of files) {
    const r = translateJava(fs.readFileSync(path.join(samplesDir, f), 'utf8'));
    assert.doesNotThrow(() => new Function(r.code), `syntax error in translated ${f}`);
    assert.deepEqual(r.warnings, [], `${f}: ${r.warnings}`);
    assert.ok(r.classes.some((c) => c.meta), `${f} registers an OpMode`);
  }
});

test('translation preserves line numbers', () => {
  const src = fs.readFileSync(path.join(samplesDir, '01_BasicTankTeleop.java'), 'utf8');
  const r = translateJava(src);
  // the runOpMode header is on the same line in both
  const jLine = src.split('\n').findIndex((l) => l.includes('public void runOpMode()'));
  const tLine = r.code.split('\n').findIndex((l) => l.includes('prototype.runOpMode'));
  assert.equal(tLine, jLine);
});

test('@TeleOp / @Autonomous / @Disabled become registrations', () => {
  const r = translateJava(`
    @TeleOp(name="Drive", group="A")
    public class A extends LinearOpMode { public void runOpMode() {} }
    @Autonomous(name = "Auto One", preselectTeleOp = "Drive")
    public class B extends LinearOpMode { public void runOpMode() {} }
    @TeleOp @Disabled
    public class C extends LinearOpMode { public void runOpMode() {} }
    public class Helper { }`);
  const reg = load(r.code);
  assert.deepEqual(reg.map((x) => [x.name, x.type, !!x.disabled]), [['Drive', 'TeleOp', false], ['Auto One', 'Autonomous', false], ['C', 'TeleOp', true]]);
  assert.equal(reg[1].preselectTeleOp, 'Drive');
});

test('fields, implicit this, parameter shadowing, statics and int arithmetic behave like Java', () => {
  const r = translateJava(`
    public class T extends LinearOpMode {
      private double power = 0.25;
      private int count = 0;
      static final int LIMIT = 3;
      static final double SCALE = LIMIT * 2.5;
      private String name = "robot";
      public void setPower(double power) { this.power = power; }
      public double getPower() { return power; }
      public int bump() { count = count + 1; int half = count / 2; return half; }
      public String describe() { return name + ":" + String.format("%.2f %d", power, count) + " " + SCALE + " " + name.length(); }
      public void runOpMode() {}
    }`);
  // load manually to get the constructor
  const globals = installJavaGlobals(globalThis);
  function LinearOpMode() {}
  const s = { ...globals, LinearOpMode, __registerOpMode: () => {} };
  const names = Object.keys(s);
  const fn = new Function(...names, r.code + '\nreturn T;');
  const Ctor = fn(...names.map((n) => s[n]));
  const t = new Ctor();
  assert.equal(t.getPower(), 0.25);
  t.setPower(0.9);
  assert.equal(t.getPower(), 0.9, 'parameter shadowing a field is handled');
  assert.equal(t.bump(), 0, 'int division truncates');
  t.bump(); t.bump();
  assert.equal(t.bump(), 2);
  assert.equal(t.describe(), 'robot:0.90 4 7.5 5');
});

test('casts, for-each, arrays, ternaries, lambdas, enhanced switch-free code', () => {
  const r = translateJava(`
    public class U {
      public double sum(double[] xs) { double s = 0; for (double x : xs) s += x; return s; }
      public int trunc(double x) { return (int) (x * 3); }
      public int[] make() { int[] a = new int[3]; a[1] = 7; int[] b = {1, 2, 3}; return new int[] {a[1], b[2], a.length}; }
      public String cast(Object o) { String s = (String) o; return s.toUpperCase(); }
      public double lam() { java.util.function.DoubleUnaryOperator f = (v) -> v * 2; return f.applyAsDouble(4); }
      public boolean tern(int v) { return v > 2 ? true : false; }
      public double neg(double v) { return (double) -v; }
    }`);
  const globals = installJavaGlobals(globalThis);
  const s = { ...globals, __registerOpMode: () => {} };
  const names = Object.keys(s);
  const U = new Function(...names, r.code + '\nreturn U;')(...names.map((n) => s[n]));
  const u = new U();
  assert.equal(u.sum([1, 2, 3.5]), 6.5);
  assert.equal(u.trunc(2.9), 8);
  assert.deepEqual(u.make(), [7, 3, 3]);
  assert.equal(u.cast('abc'), 'ABC');
  assert.equal(u.lam(), 8);
  assert.equal(u.tern(3), true);
  assert.equal(u.neg(2), -2);
  assert.deepEqual(r.warnings, []);
});

test('enums and nested static classes', () => {
  const r = translateJava(`
    public class V {
      enum Speed { SLOW(0.3), FAST(1.0); private final double p; Speed(double p) { this.p = p; } public double power() { return p; } }
      static class Pt { double x, y; Pt(double x, double y) { this.x = x; this.y = y; } double len() { return Math.hypot(x, y); } }
      public double go() { Speed s = Speed.FAST; Pt p = new Pt(3, 4); return s.power() * p.len() + Speed.values().length + Speed.SLOW.ordinal(); }
      public String nm() { return Speed.SLOW.name() + "/" + Speed.SLOW.toString(); }
    }`);
  const globals = installJavaGlobals(globalThis);
  const s = { ...globals, __registerOpMode: () => {} };
  const names = Object.keys(s);
  const V = new Function(...names, r.code + '\nreturn V;')(...names.map((n) => s[n]));
  const v = new V();
  assert.equal(v.go(), 7);
  assert.equal(v.nm(), 'SLOW/SLOW');
});

test('control-statement parentheses are not mistaken for casts', () => {
  const r = translateJava(`public class W { double o = 0; boolean b = true;
    public void f() { if (b) o += 1; while (b) { b = false; } for (int i = 0; i < 2; i++) o += i; } }`);
  assert.doesNotThrow(() => new Function(r.code));
});

test('unsupported constructs produce warnings instead of silent breakage', () => {
  const r = translateJava(`public class X { public void f() { Runnable r = new Runnable() { public void run() {} }; } }`);
  assert.ok(r.warnings.some((w) => /anonymous inner class/.test(w)));
});

test('String.format handles the common OpMode formats', () => {
  assert.equal(javaFormat('%.2f', 3.14159), '3.14');
  assert.equal(javaFormat('%7d :%7d', 42, -7), '     42 :     -7');
  assert.equal(javaFormat('left (%.2f), right (%.2f)', 1, 0.5), 'left (1.00), right (0.50)');
  assert.equal(javaFormat('%5.1f : %5.0f', 2.25, 3.7), '  2.3 :     4');
  assert.equal(javaFormat('%s=%d%%', 'a', 5), 'a=5%');
  assert.equal(javaFormat('%x', 255), 'ff');
  assert.equal(javaFormat('%04d', 7), '0007');
  assert.equal(javaFormat('%-6s|', 'ab'), 'ab    |');
  assert.equal(javaFormat('%b %c', true, 65), 'true A');
});
