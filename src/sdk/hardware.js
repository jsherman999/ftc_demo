// FTC SDK hardware classes, backed by the simulator's shared memory.
//
// Names and method signatures follow the FTC Robot Controller SDK
// (com.qualcomm.robotcore.hardware.*, org.firstinspires.ftc.robotcore.external.*,
// org.firstinspires.ftc.vision.*) so OpModes written for a real robot work here.
import { I, F, RunMode as RM, BUTTON_BITS, TAG_STRIDE, MAX_TAGS } from '../sim/shared-memory.js';
import { MOTORS, SERVOS, SENSORS, findMotor, findServo, findSensor } from '../sim/robot-config.js';

const DEG = 180 / Math.PI;

function enumOf(names) {
  const e = {};
  names.forEach((n, i) => { e[n] = Object.freeze({ name: n, ordinal: i, toString: () => n }); });
  e.values = () => names.map((n) => e[n]);
  e.valueOf = (s) => e[s];
  return Object.freeze(e);
}

// ---- units -------------------------------------------------------------------
export const AngleUnit = Object.freeze({
  DEGREES: { name: 'DEGREES', toString: () => 'DEGREES', fromDegrees: (d) => d, fromRadians: (r) => r * DEG, toDegrees: (d) => d, toRadians: (d) => d / DEG,
    normalize: (d) => normDeg(d), fromUnit: (u, v) => (u === AngleUnit.RADIANS ? v * DEG : v) },
  RADIANS: { name: 'RADIANS', toString: () => 'RADIANS', fromDegrees: (d) => d / DEG, fromRadians: (r) => r, toDegrees: (r) => r * DEG, toRadians: (r) => r,
    normalize: (r) => normRad(r), fromUnit: (u, v) => (u === AngleUnit.DEGREES ? v / DEG : v) },
  normalizeDegrees: normDeg,
  normalizeRadians: normRad,
});
function normDeg(d) { while (d > 180) d -= 360; while (d <= -180) d += 360; return d; }
function normRad(r) { while (r > Math.PI) r -= 2 * Math.PI; while (r <= -Math.PI) r += 2 * Math.PI; return r; }

const inchesTo = { MM: 25.4, CM: 2.54, METER: 0.0254, INCH: 1 };
export const DistanceUnit = Object.freeze(Object.fromEntries(['MM', 'CM', 'METER', 'INCH'].map((n) => [n, {
  name: n, toString: () => n,
  fromInches: (v) => v * inchesTo[n], toInches: (v) => v / inchesTo[n],
  fromMm: (v) => v / 25.4 * inchesTo[n], toMm: (v) => v / inchesTo[n] * 25.4,
  fromUnit: (u, v) => u.toInches(v) * inchesTo[n],
}]).concat([['infinity', Number.MAX_VALUE]])));
export const CurrentUnit = enumOf(['AMPS', 'MILLIAMPS']);
export const UnnormalizedAngleUnit = AngleUnit;

// ---- gamepad -----------------------------------------------------------------
export class Gamepad {
  constructor(views, index) {
    this.v = views; this.index = index;
    this.buttonsOffset = index === 1 ? I.GAMEPAD1_BUTTONS : I.GAMEPAD2_BUTTONS;
    this.axesOffset = index === 1 ? F.GP1_AXES : F.GP2_AXES;
    this.id = `Gamepad ${index}`;
    this._edge = {};
    for (const name of Object.keys(BUTTON_BITS)) {
      Object.defineProperty(this, name, { get: () => (Atomics.load(this.v.i32, this.buttonsOffset) & BUTTON_BITS[name]) !== 0, enumerable: true });
      const camel = name.replace(/_([a-z])/g, (m, c) => c.toUpperCase());
      this[`${camel}WasPressed`] = () => this._wasPressed(name);
      this[`${camel}WasReleased`] = () => this._wasReleased(name);
    }
    // PlayStation aliases
    Object.defineProperty(this, 'cross', { get: () => this.a });
    Object.defineProperty(this, 'circle', { get: () => this.b });
    Object.defineProperty(this, 'square', { get: () => this.x });
    Object.defineProperty(this, 'triangle', { get: () => this.y });
    Object.defineProperty(this, 'options', { get: () => this.start });
    Object.defineProperty(this, 'share', { get: () => this.back });
    Object.defineProperty(this, 'ps', { get: () => this.guide });
    this.crossWasPressed = () => this._wasPressed('a');
    this.circleWasPressed = () => this._wasPressed('b');
    this.squareWasPressed = () => this._wasPressed('x');
    this.triangleWasPressed = () => this._wasPressed('y');
  }
  get left_stick_x() { return this.v.f64[this.axesOffset + 0]; }
  get left_stick_y() { return this.v.f64[this.axesOffset + 1]; }
  get right_stick_x() { return this.v.f64[this.axesOffset + 2]; }
  get right_stick_y() { return this.v.f64[this.axesOffset + 3]; }
  get left_trigger() { return this.v.f64[this.axesOffset + 4]; }
  get right_trigger() { return this.v.f64[this.axesOffset + 5]; }
  get touchpad_finger_1() { return false; }
  atRest() { return Math.abs(this.left_stick_x) + Math.abs(this.left_stick_y) + Math.abs(this.right_stick_x) + Math.abs(this.right_stick_y) + this.left_trigger + this.right_trigger < 0.02; }
  _wasPressed(name) {
    const now = this[name];
    const was = this._edge[name] || false;
    this._edge[name] = now;
    return now && !was;
  }
  _wasReleased(name) {
    const now = this[name];
    const was = this._edge[name] || false;
    this._edge[name] = now;
    return !now && was;
  }
  rumble(a, b, c) {
    const ms = c !== undefined ? c : (typeof a === 'number' ? a : 300);
    Atomics.store(this.v.i32, this.index === 1 ? I.RUMBLE1 : I.RUMBLE2, Math.max(1, Math.round(ms)));
  }
  rumbleBlips(n) { this.rumble(n * 150); }
  stopRumble() {}
  isRumbling() { return false; }
  setLedColor() {}
  copy(other) { return this; }
  toString() { return this.id; }
}

// ---- motors --------------------------------------------------------------------
const Direction = enumOf(['FORWARD', 'REVERSE']);
const RunMode = enumOf(['RUN_WITHOUT_ENCODER', 'RUN_USING_ENCODER', 'RUN_TO_POSITION', 'STOP_AND_RESET_ENCODER']);
const ZeroPowerBehavior = enumOf(['BRAKE', 'FLOAT', 'UNKNOWN']);

export class DcMotorSimple {
  static Direction = Direction;
}

export class DcMotor extends DcMotorSimple {
  static Direction = Direction;
  static RunMode = RunMode;
  static ZeroPowerBehavior = ZeroPowerBehavior;
  constructor(views, spec) {
    super();
    this.v = views; this.spec = spec; this.i = spec.index;
    this.gang = spec.gang || [spec.index];   // every physical motor this name drives
    this._direction = Direction.FORWARD;
    this._mode = RunMode.RUN_WITHOUT_ENCODER;
    this._zpb = ZeroPowerBehavior.BRAKE;
    this._power = 0;
    this._target = 0;
    this._pendingReset = false;
    this._tolerance = 10;
    this.motorType = { getTicksPerRev: () => spec.type ? 0 : 0 };
  }
  getDeviceName() { return this.spec.name; }
  getConnectionInfo() { return `${this.spec.hub} motor port ${this.spec.port}`; }
  getPortNumber() { return this.spec.port; }
  getManufacturer() { return 'Lynx'; }
  getVersion() { return 1; }
  resetDeviceConfigurationForOpMode() {}
  close() {}
  getController() { return { getConnectionInfo: () => this.getConnectionInfo() }; }
  getMotorType() { return { getTicksPerRev: () => this._ticksPerRev(), getMaxRPM: () => this._maxRpm(), getAchieveableMaxTicksPerSecond: () => this._maxRpm() / 60 * this._ticksPerRev() }; }
  _ticksPerRev() { return MOTOR_TICKS[this.spec.type] || 0; }
  _maxRpm() { return MOTOR_RPM[this.spec.type] || 0; }

  setDirection(d) { this._direction = d; for (const i of this.gang) Atomics.store(this.v.i32, I.MOTOR_DIR_BASE + i, d === Direction.REVERSE ? 1 : 0); }
  getDirection() { return this._direction; }
  setPower(p) {
    if (typeof p !== 'number' || Number.isNaN(p)) throw new Error(`setPower(${p}): power must be a number between -1.0 and 1.0`);
    this._power = Math.max(-1, Math.min(1, p));
    for (const i of this.gang) {
      this.v.f64[F.MOTOR_POWER_BASE + i] = this._power;
      this.v.f64[F.MOTOR_VELOCITY_BASE + i] = NaN; // setPower cancels a velocity setpoint
    }
  }
  getPower() { return this._power; }
  setMode(m) {
    if (!m || m.ordinal === undefined) throw new Error('setMode() expects a DcMotor.RunMode');
    this._mode = m;
    for (const i of this.gang) {
      Atomics.store(this.v.i32, I.MOTOR_MODE_BASE + i, m.ordinal);
      if (m === RunMode.STOP_AND_RESET_ENCODER) {
        this._pendingReset = true;
        Atomics.add(this.v.i32, I.MOTOR_RESET_BASE + i, 1);
      }
    }
  }
  getMode() { return this._mode; }
  setZeroPowerBehavior(z) { this._zpb = z; for (const i of this.gang) Atomics.store(this.v.i32, I.MOTOR_ZPB_BASE + i, z === ZeroPowerBehavior.FLOAT ? 0 : 1); }
  getZeroPowerBehavior() { return this._zpb; }
  setPowerFloat() { this.setZeroPowerBehavior(ZeroPowerBehavior.FLOAT); this.setPower(0); }
  getPowerFloat() { return this._zpb === ZeroPowerBehavior.FLOAT && this._power === 0; }
  setTargetPosition(t) {
    if (typeof t !== 'number') throw new Error('setTargetPosition() expects an int');
    this._target = Math.trunc(t);
    for (const i of this.gang) Atomics.store(this.v.i32, I.MOTOR_TARGET_BASE + i, this._target);
  }
  getTargetPosition() { return this._target; }
  getCurrentPosition() {
    if (this._pendingReset) {
      const req = Atomics.load(this.v.i32, I.MOTOR_RESET_BASE + this.i);
      if (Atomics.load(this.v.i32, I.MOTOR_RESET_ACK_BASE + this.i) !== req) return 0;
      this._pendingReset = false;
    }
    return Math.trunc(this.v.f64[F.MOTOR_ENC_BASE + this.i]);
  }
  isBusy() { return this._mode === RunMode.RUN_TO_POSITION && Math.abs(this._target - this.getCurrentPosition()) > this._tolerance; }
  isMotorEnabled() { return true; }
  setMotorEnable() {} setMotorDisable() {}
  // DcMotorEx --------------------------------------------------------------
  setVelocity(v, unit) {
    let tps = v;
    if (unit) tps = (unit === AngleUnit.DEGREES ? v / 360 : v / (2 * Math.PI)) * this._ticksPerRev();
    if (this._mode !== RunMode.RUN_USING_ENCODER) this.setMode(RunMode.RUN_USING_ENCODER);
    for (const i of this.gang) this.v.f64[F.MOTOR_VELOCITY_BASE + i] = tps;
    this._power = Math.max(-1, Math.min(1, tps / (this._maxRpm() / 60 * this._ticksPerRev() || 1)));
  }
  getVelocity(unit) {
    const tps = this.v.f64[F.MOTOR_VEL_BASE + this.i];
    if (!unit) return tps;
    return unit === AngleUnit.DEGREES ? tps / this._ticksPerRev() * 360 : tps / this._ticksPerRev() * 2 * Math.PI;
  }
  getCurrent(unit) { const a = this.v.f64[F.MOTOR_CURRENT_BASE + this.i]; return unit === CurrentUnit.MILLIAMPS ? a * 1000 : a; }
  getCurrentAlert(unit) { return unit === CurrentUnit.MILLIAMPS ? 9200 : 9.2; }
  setCurrentAlert() {}
  isOverCurrent() { return false; }
  setTargetPositionTolerance(t) { this._tolerance = t; }
  getTargetPositionTolerance() { return this._tolerance; }
  setPIDFCoefficients() {} setVelocityPIDFCoefficients() {} setPositionPIDFCoefficients() {}
  getPIDFCoefficients() { return { p: 10, i: 3, d: 0, f: 0 }; }
  toString() { return `DcMotor(${this.spec.name})`; }
}
export class DcMotorEx extends DcMotor {}
export class DcMotorImplEx extends DcMotor {}
const MOTOR_TICKS = { goBILDA_312: 537.7, goBILDA_435: 384.5, goBILDA_1150: 145.1, goBILDA_6000: 28, REV_HD_HEX_20: 560, REV_CORE_HEX: 288 };
const MOTOR_RPM = { goBILDA_312: 312, goBILDA_435: 435, goBILDA_1150: 1150, goBILDA_6000: 6000, REV_HD_HEX_20: 300, REV_CORE_HEX: 125 };

// ---- servos --------------------------------------------------------------------
export class Servo {
  static Direction = Direction;
  static MIN_POSITION = 0;
  static MAX_POSITION = 1;
  constructor(views, spec) {
    this.v = views; this.spec = spec; this.i = spec.index;
    this._pos = 0; this._dir = Direction.FORWARD; this._min = 0; this._max = 1;
  }
  getDeviceName() { return this.spec.name; }
  getConnectionInfo() { return `${this.spec.hub} servo port ${this.spec.port}`; }
  getPortNumber() { return this.spec.port; }
  getController() { return { pwmEnable() {}, pwmDisable() {} }; }
  setDirection(d) { this._dir = d; Atomics.store(this.v.i32, I.SERVO_DIR_BASE + this.i, d === Direction.REVERSE ? 1 : 0); }
  getDirection() { return this._dir; }
  setPosition(p) {
    if (typeof p !== 'number' || Number.isNaN(p)) throw new Error(`setPosition(${p}): position must be a number between 0.0 and 1.0`);
    this._pos = Math.max(0, Math.min(1, p));
    this.v.f64[F.SERVO_POS_BASE + this.i] = this._min + this._pos * (this._max - this._min);
  }
  getPosition() { return this._pos; }
  scaleRange(min, max) { this._min = min; this._max = max; }
  setPwmEnable() {} setPwmDisable() {} isPwmEnabled() { return true; }
  setPwmRange() {}
  close() {}
  toString() { return `Servo(${this.spec.name})`; }
}
export class ServoImplEx extends Servo {}
export const PwmControl = { PwmRange: class PwmRange { constructor(a, b) { this.usPulseLower = a; this.usPulseUpper = b; } } };

export class CRServo {
  static Direction = Direction;
  constructor(views, spec) { this.v = views; this.spec = spec; this.i = spec.index; this._power = 0; this._dir = Direction.FORWARD; }
  getDeviceName() { return this.spec.name; }
  getConnectionInfo() { return `${this.spec.hub} servo port ${this.spec.port}`; }
  getPortNumber() { return this.spec.port; }
  setDirection(d) { this._dir = d; Atomics.store(this.v.i32, I.SERVO_DIR_BASE + this.i, d === Direction.REVERSE ? 1 : 0); }
  getDirection() { return this._dir; }
  setPower(p) { this._power = Math.max(-1, Math.min(1, p)); this.v.f64[F.SERVO_POS_BASE + this.i] = this._power; }
  getPower() { return this._power; }
  setPwmEnable() {} setPwmDisable() {}
  toString() { return `CRServo(${this.spec.name})`; }
}
export class CRServoImplEx extends CRServo {}

// ---- IMU -------------------------------------------------------------------------
export class YawPitchRollAngles {
  constructor(yawDeg, pitchDeg, rollDeg, t) { this._y = yawDeg; this._p = pitchDeg; this._r = rollDeg; this._t = t; }
  getYaw(u) { return u === AngleUnit.RADIANS ? this._y / DEG : this._y; }
  getPitch(u) { return u === AngleUnit.RADIANS ? this._p / DEG : this._p; }
  getRoll(u) { return u === AngleUnit.RADIANS ? this._r / DEG : this._r; }
  getAcquisitionTime() { return this._t; }
  toString() { return `{yaw=${this._y.toFixed(1)}, pitch=${this._p.toFixed(1)}, roll=${this._r.toFixed(1)}}`; }
}
export class AngularVelocity {
  constructor(unit, x, y, z, t) { this.unit = unit; this.xRotationRate = x; this.yRotationRate = y; this.zRotationRate = z; this.acquisitionTime = t; }
  toAngleUnit(u) { if (u === this.unit) return this; const k = u === AngleUnit.RADIANS ? 1 / DEG : DEG; return new AngularVelocity(u, this.xRotationRate * k, this.yRotationRate * k, this.zRotationRate * k, this.acquisitionTime); }
}
export class Orientation {
  constructor(yawDeg) { this.firstAngle = yawDeg; this.secondAngle = 0; this.thirdAngle = 0; this.angleUnit = AngleUnit.DEGREES; }
}
export class Quaternion { constructor() { this.w = 1; this.x = 0; this.y = 0; this.z = 0; } }
export const AxesReference = enumOf(['EXTRINSIC', 'INTRINSIC']);
export const AxesOrder = enumOf(['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX', 'XYX', 'XZX', 'YXY', 'YZY', 'ZXZ', 'ZYZ']);

export class RevHubOrientationOnRobot {
  static LogoFacingDirection = enumOf(['UP', 'DOWN', 'FORWARD', 'BACKWARD', 'LEFT', 'RIGHT']);
  static UsbFacingDirection = enumOf(['UP', 'DOWN', 'FORWARD', 'BACKWARD', 'LEFT', 'RIGHT']);
  constructor(logo, usb) {
    if (logo && logo.name && usb && usb.name && logo.name === usb.name) throw new Error('IllegalArgumentException: the logo and USB directions cannot be the same');
    this.logo = logo; this.usb = usb;
  }
}
export class Rev9AxisImuOrientationOnRobot extends RevHubOrientationOnRobot {
  static LogoFacingDirection = RevHubOrientationOnRobot.LogoFacingDirection;
  static I2cPortFacingDirection = RevHubOrientationOnRobot.UsbFacingDirection;
}

export class IMU {
  static Parameters = class Parameters { constructor(orientation) { this.imuOrientationOnRobot = orientation; } };
  constructor(views, spec) { this.v = views; this.spec = spec; this._initialized = false; }
  getDeviceName() { return 'Control Hub IMU (BHI260AP)'; }
  getConnectionInfo() { return 'Control Hub I2C bus 0'; }
  initialize(params) {
    if (!params || !params.imuOrientationOnRobot) throw new Error('imu.initialize() needs an IMU.Parameters(new RevHubOrientationOnRobot(logo, usb))');
    this._initialized = true;
    return true;
  }
  resetYaw() { Atomics.add(this.v.i32, I.IMU_RESET_YAW, 1); }
  getRobotYawPitchRollAngles() {
    return new YawPitchRollAngles(this.v.f64[F.IMU_YAW], this.v.f64[F.IMU_PITCH], this.v.f64[F.IMU_ROLL], this.v.f64[F.TIME_S] * 1e9);
  }
  getRobotAngularVelocity(unit) {
    const k = unit === AngleUnit.RADIANS ? 1 / DEG : 1;
    return new AngularVelocity(unit || AngleUnit.DEGREES, this.v.f64[F.IMU_ROLL_RATE] * k, this.v.f64[F.IMU_PITCH_RATE] * k, this.v.f64[F.IMU_YAW_RATE] * k, this.v.f64[F.TIME_S] * 1e9);
  }
  getRobotOrientation(ref, order, unit) {
    const o = new Orientation(this.v.f64[F.IMU_YAW]);
    if (unit === AngleUnit.RADIANS) { o.firstAngle /= DEG; o.angleUnit = AngleUnit.RADIANS; }
    return o;
  }
  getRobotOrientationAsQuaternion() { return new Quaternion(); }
  close() {}
}

// ---- sensors -----------------------------------------------------------------------
export class DistanceSensor {
  static distanceOutOfRange = DistanceUnit.infinity;
  constructor(views, spec) { this.v = views; this.spec = spec; }
  getDeviceName() { return 'REV 2M Distance Sensor'; }
  getConnectionInfo() { return `${this.spec.hub} ${this.spec.port}`; }
  getDistance(unit) {
    const inches = this.v.f64[F.DISTANCE_IN];
    return (unit || DistanceUnit.INCH).fromInches(inches);
  }
  getModelID() { return 0xEE; }
  didTimeoutOccur() { return false; }
  initialize() { return true; }
  close() {}
}
export class Rev2mDistanceSensor extends DistanceSensor {}

export class NormalizedRGBA {
  constructor(r, g, b, a) { this.red = r; this.green = g; this.blue = b; this.alpha = a; }
  toColor() { return ((Math.round(this.alpha * 255) << 24) | (Math.round(this.red * 255) << 16) | (Math.round(this.green * 255) << 8) | Math.round(this.blue * 255)) >>> 0; }
}
export class ColorSensor {
  constructor(views, spec) { this.v = views; this.spec = spec; this._gain = 2; this._led = true; }
  getDeviceName() { return 'REV Color Sensor V3'; }
  getConnectionInfo() { return `${this.spec.hub} ${this.spec.port}`; }
  red() { return Math.round(this.v.f64[F.COLOR_R] * 1024 * this._gain / 2); }
  green() { return Math.round(this.v.f64[F.COLOR_G] * 1024 * this._gain / 2); }
  blue() { return Math.round(this.v.f64[F.COLOR_B] * 1024 * this._gain / 2); }
  alpha() { return Math.round(this.v.f64[F.COLOR_A] * 1024 * this._gain / 2); }
  argb() { return this.getNormalizedColors().toColor(); }
  enableLed(on) { this._led = on; }
  enableLight(on) { this._led = on; }
  isLightOn() { return this._led; }
  setI2cAddress() {} getI2cAddress() { return 0x52; }
  // NormalizedColorSensor
  getNormalizedColors() {
    const g = this._gain / 2;
    const c = (i) => Math.min(1, this.v.f64[i] * g);
    return new NormalizedRGBA(c(F.COLOR_R), c(F.COLOR_G), c(F.COLOR_B), c(F.COLOR_A));
  }
  setGain(g) { this._gain = g; } getGain() { return this._gain; }
  // RevColorSensorV3 also reports distance
  getDistance(unit) { return (unit || DistanceUnit.INCH).fromInches(this.v.f64[F.COLOR_DIST_IN]); }
  getRawLightDetected() { return this.v.f64[F.COLOR_A]; }
  getLightDetected() { return this.v.f64[F.COLOR_A]; }
  close() {}
}
export class NormalizedColorSensor extends ColorSensor {}
export class RevColorSensorV3 extends ColorSensor {}
export class SwitchableLight extends ColorSensor {}
export class LightSensor extends ColorSensor {}

export class TouchSensor {
  constructor(views, spec) { this.v = views; this.spec = spec; }
  getDeviceName() { return 'REV Touch Sensor'; }
  getConnectionInfo() { return `${this.spec.hub} ${this.spec.port}`; }
  isPressed() { return this.v.f64[F.TOUCH] > 0.5; }
  getValue() { return this.isPressed() ? 1 : 0; }
  close() {}
}
export class DigitalChannel {
  static Mode = enumOf(['INPUT', 'OUTPUT']);
  constructor(views, spec) { this.v = views; this.spec = spec; this._mode = DigitalChannel.Mode.INPUT; }
  setMode(m) { this._mode = m; }
  getMode() { return this._mode; }
  // REV touch sensors pull the line LOW when pressed
  getState() { return !(this.v.f64[F.TOUCH] > 0.5); }
  setState() {}
}

// ---- vision -----------------------------------------------------------------------
export class WebcamName {
  constructor(views, spec) { this.v = views; this.spec = spec; }
  getDeviceName() { return this.spec.name; }
  getConnectionInfo() { return 'USB 2.0'; }
  isWebcam() { return true; }
  isCameraDirection() { return false; }
  isAttached() { return true; }
  toString() { return this.spec.name; }
}
export const BuiltinCameraDirection = enumOf(['BACK', 'FRONT']);
export const CameraCompatibilityManager = { isCameraCompatible: () => true };

export class AprilTagPoseFtc {
  constructor(r) { this.x = r.x; this.y = r.y; this.z = r.z; this.yaw = r.yaw; this.pitch = r.pitch; this.roll = r.roll; this.range = r.range; this.bearing = r.bearing; this.elevation = r.elevation; }
}
export class AprilTagMetadata {
  constructor(id, name, tagsize) { this.id = id; this.name = name; this.tagsize = tagsize; this.distanceUnit = DistanceUnit.INCH; this.fieldPosition = null; this.fieldOrientation = null; }
}
export class AprilTagDetection {
  constructor(r) {
    this.id = r.id;
    this.hamming = 0; this.decisionMargin = 60;
    this.center = { x: 320 + Math.tan(-r.bearing / DEG) * 500, y: 240 - Math.tan(r.elevation / DEG) * 500 };
    this.corners = [];
    this.metadata = new AprilTagMetadata(r.id, r.name, 3.25);
    this.ftcPose = new AprilTagPoseFtc(r);
    this.rawPose = { x: r.x, y: -r.z, z: r.y };
    this.robotPose = null;
    this.frameAcquisitionNanoTime = 0;
  }
}
export class AprilTagSingleDetection extends AprilTagDetection {}
export class AprilTagClusterDetection extends AprilTagDetection {
  constructor(r) { super(r); this.percentClusterFound = r.percent; this.metadata = new AprilTagMetadata(r.id, r.name, 3.25); }
}
export const AprilTagLibrary = class AprilTagLibrary { static Builder = class { addTag() { return this; } addTags() { return this; } setAllowOverwrite() { return this; } build() { return new AprilTagLibrary(); } }; lookupTag(id) { return new AprilTagMetadata(id, `tag ${id}`, 3.25); } };
export const AprilTagGameDatabase = {
  getCurrentGameTagLibrary: () => new AprilTagLibrary(),
  getBiobuzzTagLibrary: () => new AprilTagLibrary(),
  getCenterStageTagLibrary: () => new AprilTagLibrary(),
  getIntoTheDeepTagLibrary: () => new AprilTagLibrary(),
  getDecodeTagLibrary: () => new AprilTagLibrary(),
  getSampleTagLibrary: () => new AprilTagLibrary(),
};

export class AprilTagProcessor {
  static TagFamily = enumOf(['TAG_36h11', 'TAG_25h9', 'TAG_16h5', 'TAG_standard41h12']);
  static PoseSolver = enumOf(['APRILTAG_BUILTIN', 'OPENCV_ITERATIVE', 'OPENCV_SOLVEPNP_EPNP', 'OPENCV_IPPE', 'OPENCV_IPPE_SQUARE', 'OPENCV_SQPNP']);
  static Builder = class Builder {
    constructor() { this.opts = {}; }
    setDrawAxes(v) { this.opts.axes = v; return this; }
    setDrawCubeProjection(v) { return this; }
    setDrawTagOutline(v) { return this; }
    setDrawTagID(v) { return this; }
    setTagFamily(v) { this.opts.family = v; return this; }
    setTagLibrary(v) { return this; }
    setOutputUnits(d, a) { this.opts.distanceUnit = d; this.opts.angleUnit = a; return this; }
    setLensIntrinsics() { return this; }
    setNumThreads() { return this; }
    setSuppressCalibrationWarnings() { return this; }
    setCameraPose() { return this; }
    setPoseSolver() { return this; }
    build() { return new AprilTagProcessor(this.opts); }
  };
  static easyCreateWithDefaults() { return new AprilTagProcessor({}); }
  constructor(opts) { this.opts = opts; this.v = null; this._enabled = true; this._lastTick = -1; this._decimation = 1; }
  _attach(views) { this.v = views; }
  setDecimation(d) { this._decimation = d; }
  setPoseSolver() {}
  getPerTagAvgPoseSolveTime() { return 2; }
  getDetections() {
    if (!this.v || !this._enabled) return [];
    const out = [];
    const n = Math.min(Atomics.load(this.v.i32, I.TAG_COUNT), MAX_TAGS);
    const du = this.opts.distanceUnit || DistanceUnit.INCH;
    const au = this.opts.angleUnit || AngleUnit.DEGREES;
    for (let t = 0; t < n; t++) {
      const o = F.TAG_BASE + t * TAG_STRIDE;
      const f = this.v.f64;
      const r = {
        id: f[o], isCluster: f[o + 1] === 1,
        x: du.fromInches(f[o + 2]), y: du.fromInches(f[o + 3]), z: du.fromInches(f[o + 4]),
        yaw: au === AngleUnit.RADIANS ? f[o + 5] / DEG : f[o + 5],
        pitch: au === AngleUnit.RADIANS ? f[o + 6] / DEG : f[o + 6],
        roll: au === AngleUnit.RADIANS ? f[o + 7] / DEG : f[o + 7],
        range: du.fromInches(f[o + 8]),
        bearing: au === AngleUnit.RADIANS ? f[o + 9] / DEG : f[o + 9],
        elevation: au === AngleUnit.RADIANS ? f[o + 10] / DEG : f[o + 10],
        percent: f[o + 11],
      };
      r.name = clusterName(r.id, r.isCluster);
      out.push(r.isCluster ? new AprilTagClusterDetection(r) : new AprilTagSingleDetection(r));
    }
    return new (globalThis.ArrayList || Array)(...[]).concat ? Object.assign(out, listMethods) : out;
  }
  getFreshDetections() {
    const tick = Atomics.load(this.v.i32, I.TICK);
    if (tick === this._lastTick) return null;
    this._lastTick = tick;
    return this.getDetections();
  }
}
const listMethods = {
  size() { return this.length; }, get(i) { return this[i]; }, isEmpty() { return this.length === 0; },
  add(x) { this.push(x); return true; }, contains(x) { return this.includes(x); },
};
function clusterName(id, isCluster) {
  const base = id >= 42 ? 'BLUE SCORING' : id >= 38 ? 'BLUE AUDIENCE' : id >= 34 ? 'RED AUDIENCE' : 'RED SCORING';
  if (isCluster) return base;
  const slot = ((id - 30) % 4) + 1;
  return `${base} slot ${slot}`;
}

export class VisionPortal {
  static CameraState = enumOf(['OPENING_CAMERA_DEVICE', 'CAMERA_DEVICE_READY', 'STARTING_STREAM', 'STREAMING', 'STOPPING_STREAM', 'CAMERA_DEVICE_CLOSED', 'ERROR']);
  static StreamFormat = enumOf(['YUY2', 'MJPEG']);
  static MultiPortalLayout = enumOf(['VERTICAL', 'HORIZONTAL']);
  static Builder = class Builder {
    constructor() { this.processors = []; this.camera = null; }
    setCamera(c) { this.camera = c; return this; }
    addProcessor(p) { this.processors.push(p); return this; }
    addProcessors(...p) { this.processors.push(...p.flat()); return this; }
    setCameraResolution() { return this; }
    setStreamFormat() { return this; }
    enableLiveView() { return this; }
    setAutoStopLiveView() { return this; }
    setLiveViewContainerId() { return this; }
    setAutoStartStreamOnBuild() { return this; }
    setShowStatsOverlay() { return this; }
    build() { return new VisionPortal(this.camera, this.processors); }
  };
  static easyCreateWithDefaults(camera, ...processors) { return new VisionPortal(camera, processors.flat()); }
  static makeMultiPortalView(n) { return Array.from({ length: n }, (_, i) => i + 1); }
  constructor(camera, processors) {
    if (!camera) throw new Error('VisionPortal needs a camera: hardwareMap.get(WebcamName.class, "Webcam 1")');
    this.camera = camera; this.processors = processors;
    this.v = camera.v;
    for (const p of processors) if (p && p._attach) p._attach(this.v);
    this._state = VisionPortal.CameraState.STREAMING;
    Atomics.store(this.v.i32, I.VISION_ENABLED, 1);
  }
  getCameraState() { return this._state; }
  getFps() { return 30; }
  setProcessorEnabled(p, on) { p._enabled = on; }
  getProcessorEnabled(p) { return p._enabled; }
  stopStreaming() { this._state = VisionPortal.CameraState.CAMERA_DEVICE_READY; Atomics.store(this.v.i32, I.VISION_ENABLED, 0); }
  resumeStreaming() { this._state = VisionPortal.CameraState.STREAMING; Atomics.store(this.v.i32, I.VISION_ENABLED, 1); }
  stopLiveView() {} resumeLiveView() {}
  saveNextFrameRaw() {}
  getCameraControl(cls) { return { setMode() { return true; }, setExposure() { return true; }, setGain() { return true; }, getMinExposure() { return 1; }, getMaxExposure() { return 100; }, getMinGain() { return 0; }, getMaxGain() { return 255; }, isExposureSupported() { return true; }, getExposure() { return 10; }, getGain() { return 50; }, getMode() { return null; } }; }
  close() { this._state = VisionPortal.CameraState.CAMERA_DEVICE_CLOSED; Atomics.store(this.v.i32, I.VISION_ENABLED, 0); }
  getActiveCamera() { return this.camera; }
  setActiveCamera() {}
}
export const ExposureControl = { Mode: enumOf(['Unknown', 'Auto', 'ContinuousAuto', 'Manual', 'ShutterPriority', 'AperturePriority']) };
export const GainControl = {};

// ---- hardware map ------------------------------------------------------------------
export class HardwareMap {
  constructor(views) {
    this.v = views;
    this._cache = new Map();
    const mk = (kind) => ({
      get: (name) => this.get(kind, name),
      iterator: () => [][Symbol.iterator](),
    });
    this.dcMotor = mk(DcMotor);
    this.servo = mk(Servo);
    this.crservo = mk(CRServo);
    this.touchSensor = mk(TouchSensor);
    this.colorSensor = mk(ColorSensor);
    this.digitalChannel = mk(DigitalChannel);
    this.appContext = {};
    this.voltageSensor = { get: () => this._voltageSensor(), iterator: () => [this._voltageSensor()][Symbol.iterator]() };
  }
  _voltageSensor() { return { getVoltage: () => this.v.f64[F.BATTERY_V], getDeviceName: () => 'Control Hub voltage sensor' }; }
  getAll(type) {
    const name = typeName(type);
    if (name === 'VoltageSensor') return [this._voltageSensor()];
    if (name === 'LynxModule') return [{ setBulkCachingMode() {}, clearBulkCache() {}, getInputVoltage: () => this.v.f64[F.BATTERY_V] }];
    if (name === 'IMU') return [this.get(type, 'imu')];
    return [];
  }
  tryGet(type, name) { try { return this.get(type, name); } catch (e) { return null; } }
  get(type, name) {
    if (typeof type === 'string' && name === undefined) { name = type; type = null; }
    const key = `${typeName(type)}:${name}`;
    if (this._cache.has(key)) return this._cache.get(key);
    const dev = this._create(type, name);
    this._cache.set(key, dev);
    return dev;
  }
  _create(type, name) {
    const tn = typeName(type);
    const motor = findMotor(name), servo = findServo(name), sensor = findSensor(name);
    const fail = () => {
      const known = [...MOTORS.map((m) => `${m.name} (DcMotor)`), ...SERVOS.map((s) => `${s.name} (${s.kind === 'crservo' ? 'CRServo' : 'Servo'})`), ...SENSORS.map((s) => `${s.name} (${s.type})`)];
      throw new Error(`Unable to find a hardware device with name "${name}" and type ${tn || 'any'}.\nConfigured devices: ${known.join(', ')}`);
    };
    const motorTypes = ['DcMotor', 'DcMotorEx', 'DcMotorSimple', 'DcMotorImplEx', 'DcMotorImpl'];
    const servoTypes = ['Servo', 'ServoImplEx', 'ServoImpl', 'PwmControl'];
    const crTypes = ['CRServo', 'CRServoImplEx', 'CRServoImpl'];
    if (motor && (tn === null || motorTypes.includes(tn))) return new DcMotor(this.v, motor);
    if (servo) {
      if (servo.kind === 'crservo' && (tn === null || crTypes.includes(tn) || tn === 'DcMotorSimple')) return new CRServo(this.v, servo);
      if (servo.kind === 'servo' && (tn === null || servoTypes.includes(tn))) return new Servo(this.v, servo);
      if (servo.kind === 'servo' && crTypes.includes(tn)) throw new Error(`"${name}" is configured as a Servo, not a CRServo. Change the Robot Configuration or use Servo.class.`);
      if (servo.kind === 'crservo' && servoTypes.includes(tn)) throw new Error(`"${name}" is configured as a CRServo (continuous rotation). Use CRServo.class.`);
    }
    if (sensor) {
      const st = sensor.type;
      if (st === 'IMU' && (tn === null || tn === 'IMU' || tn === 'BNO055IMU')) return new IMU(this.v, sensor);
      if (st === 'DistanceSensor' && (tn === null || ['DistanceSensor', 'Rev2mDistanceSensor'].includes(tn))) return new DistanceSensor(this.v, sensor);
      if (st === 'ColorSensor' && (tn === null || ['ColorSensor', 'NormalizedColorSensor', 'RevColorSensorV3', 'SwitchableLight', 'LightSensor', 'DistanceSensor'].includes(tn))) return new ColorSensor(this.v, sensor);
      if (st === 'TouchSensor' && (tn === null || tn === 'TouchSensor')) return new TouchSensor(this.v, sensor);
      if (st === 'TouchSensor' && tn === 'DigitalChannel') return new DigitalChannel(this.v, sensor);
      if (st === 'WebcamName' && (tn === null || tn === 'WebcamName' || tn === 'CameraName')) return new WebcamName(this.v, sensor);
    }
    if (motor || servo || sensor) {
      throw new Error(`Hardware device "${name}" exists but is not a ${tn}. It is configured as ${motor ? 'a DcMotor' : servo ? (servo.kind === 'crservo' ? 'a CRServo' : 'a Servo') : 'a ' + sensor.type}.`);
    }
    return fail();
  }
}
function typeName(type) {
  if (type === null || type === undefined) return null;
  if (typeof type === 'string') return type;
  return type.name || String(type);
}
