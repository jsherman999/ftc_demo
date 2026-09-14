// Shared-memory layout between the simulator (main thread) and the OpMode
// runtime (worker). The hubs on a real robot are polled over a serial bus;
// here the "bus" is a SharedArrayBuffer. The runtime writes commands (motor
// power, servo position ...) and reads sensors (encoder counts, IMU ...);
// the simulator does the opposite once per physics step.
//
// Layout (all offsets in elements):
//   Int32Array  control block  (flags, gamepad buttons, tick counter)
//   Float64Array data block    (commands + sensors)

export const MAX_MOTORS = 8;
export const MAX_SERVOS = 6;
export const MAX_TAGS = 24;    // AprilTag detections exposed at once (clusters + single tags)

// ---- Int32 control block --------------------------------------------------
export const I = Object.freeze({
  TICK: 0,              // incremented by the simulator every physics step (Atomics.notify target)
  STATE: 1,             // OpModeState (below)
  STOP_REQUESTED: 2,    // 1 when STOP pressed
  GAMEPAD1_BUTTONS: 3,  // bitfield (see BUTTON_BITS)
  GAMEPAD2_BUTTONS: 4,
  MOTOR_MODE_BASE: 8,   // MAX_MOTORS entries: RunMode ordinal
  MOTOR_DIR_BASE: 16,   // MAX_MOTORS entries: 0 forward, 1 reverse
  MOTOR_ZPB_BASE: 24,   // MAX_MOTORS entries: 0 float, 1 brake
  MOTOR_TARGET_BASE: 32,// MAX_MOTORS entries: target position (ticks)
  MOTOR_RESET_BASE: 40, // MAX_MOTORS entries: incremented to request an encoder reset
  MOTOR_RESET_ACK_BASE: 48,
  SERVO_DIR_BASE: 56,   // MAX_SERVOS: 0 forward, 1 reverse
  VISION_ENABLED: 64,
  IMU_RESET_YAW: 65,    // incremented by runtime; simulator zeroes yaw and copies to ACK
  IMU_RESET_ACK: 66,
  TAG_COUNT: 67,
  RUMBLE1: 68,          // runtime sets ms of rumble requested (simulator clears)
  RUMBLE2: 69,
  TELEMETRY_SEQ: 70,
  WATCHDOG: 71,         // runtime increments while the OpMode runs (liveness)
  SIZE: 96,
});

export const OpModeState = Object.freeze({
  IDLE: 0, INIT: 1, RUNNING: 2, STOPPED: 3, ERROR: 4,
});

// ---- Float64 data block -----------------------------------------------------
export const F = Object.freeze({
  TIME_S: 0,            // simulated time since the simulator started
  MATCH_TIME_S: 1,      // seconds since the current OpMode was started (for telemetry)
  BATTERY_V: 2,
  // commands
  MOTOR_POWER_BASE: 8,       // MAX_MOTORS
  MOTOR_VELOCITY_BASE: 16,   // MAX_MOTORS: velocity setpoint ticks/s (RUN_USING_ENCODER via setVelocity)
  SERVO_POS_BASE: 24,        // MAX_SERVOS: 0..1 (or -1..1 power for CR servos)
  // sensors
  MOTOR_ENC_BASE: 32,        // MAX_MOTORS: encoder ticks (after reset offset)
  MOTOR_VEL_BASE: 40,        // MAX_MOTORS: ticks / second
  MOTOR_CURRENT_BASE: 48,    // MAX_MOTORS: amps
  IMU_YAW: 56, IMU_PITCH: 57, IMU_ROLL: 58, // degrees
  IMU_YAW_RATE: 59, IMU_PITCH_RATE: 60, IMU_ROLL_RATE: 61,
  IMU_ACC_X: 62, IMU_ACC_Y: 63, IMU_ACC_Z: 64,
  DISTANCE_IN: 65,           // front distance sensor (inches, 78 max)
  COLOR_R: 66, COLOR_G: 67, COLOR_B: 68, COLOR_A: 69, COLOR_DIST_IN: 70,
  TOUCH: 71,                 // 1 pressed
  GP1_AXES: 72,              // 6 entries: lx, ly, rx, ry, lt, rt
  GP2_AXES: 78,
  MAGAZINE_COUNT: 84,        // number of balls in the robot
  LAUNCHER_RPM: 85,
  // robot pose (what a perfect odometry computer would report; also used by the UI)
  POSE_X: 86, POSE_Y: 87, POSE_HEADING_DEG: 88,
  SERVO_ACTUAL_BASE: 90,     // MAX_SERVOS: actual servo position (servos move at finite speed)
  // AprilTag detections: MAX_TAGS records of TAG_STRIDE values
  TAG_BASE: 96,
  SIZE: 96 + MAX_TAGS * 12,
});
export const TAG_STRIDE = 12;
// record layout: id, isCluster, x, y, z, yaw, pitch, roll, range, bearing, elevation, percentFound

export const RunMode = Object.freeze({
  RUN_WITHOUT_ENCODER: 0, RUN_USING_ENCODER: 1, RUN_TO_POSITION: 2, STOP_AND_RESET_ENCODER: 3,
});

export const BUTTON_BITS = Object.freeze({
  a: 1 << 0, b: 1 << 1, x: 1 << 2, y: 1 << 3,
  left_bumper: 1 << 4, right_bumper: 1 << 5,
  dpad_up: 1 << 6, dpad_down: 1 << 7, dpad_left: 1 << 8, dpad_right: 1 << 9,
  left_stick_button: 1 << 10, right_stick_button: 1 << 11,
  start: 1 << 12, back: 1 << 13, guide: 1 << 14,
  touchpad: 1 << 15,
});

export function createSharedMemory() {
  const ints = new SharedArrayBuffer(I.SIZE * 4);
  const floats = new SharedArrayBuffer(F.SIZE * 8);
  return { ints, floats };
}

export function viewsOf(mem) {
  return { i32: new Int32Array(mem.ints), f64: new Float64Array(mem.floats) };
}

/** Reset every command/sensor slot to its power-on value. */
export function initSharedDefaults(views) {
  const { i32, f64 } = views;
  i32.fill(0);
  f64.fill(0);
  for (let i = 0; i < MAX_MOTORS; i++) f64[F.MOTOR_VELOCITY_BASE + i] = NaN; // "no velocity setpoint"
  f64[F.BATTERY_V] = 12.9;
}
