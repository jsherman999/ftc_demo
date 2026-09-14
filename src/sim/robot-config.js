// Hardware configuration of the virtual robot.
//
// This mirrors what a team enters in the Robot Controller "Configure Robot"
// screen: each device has a port on a REV Control Hub / Expansion Hub and a
// name that OpModes use with hardwareMap.get(Type.class, "name").
//
// The default robot is modelled on the goBILDA FTC StarterBot for BIOBUZZ
// (an intake that pulls POLLEN off the floor, a flywheel launcher for the HIVE
// shot) placed on a mecanum chassis so students can practise both tank-style
// and holonomic driving. The tank chassis option keeps the same mechanisms.

export const MOTOR_TYPES = Object.freeze({
  // goBILDA 5203 Yellow Jacket planetary motors (ticks per output-shaft revolution)
  goBILDA_312: { name: 'goBILDA 5203 312 RPM', freeRpm: 312, ticksPerRev: 537.7, stallTorqueNm: 2.35 },
  goBILDA_435: { name: 'goBILDA 5203 435 RPM', freeRpm: 435, ticksPerRev: 384.5, stallTorqueNm: 1.86 },
  goBILDA_1150: { name: 'goBILDA 5203 1150 RPM', freeRpm: 1150, ticksPerRev: 145.1, stallTorqueNm: 0.69 },
  goBILDA_6000: { name: 'goBILDA 5202 bare (6000 RPM)', freeRpm: 6000, ticksPerRev: 28, stallTorqueNm: 0.14 },
  REV_HD_HEX_20: { name: 'REV HD Hex 20:1', freeRpm: 300, ticksPerRev: 560, stallTorqueNm: 2.1 },
  REV_CORE_HEX: { name: 'REV Core Hex', freeRpm: 125, ticksPerRev: 288, stallTorqueNm: 0.31 },
});

/** Motor port layout (index into the shared-memory motor arrays). */
export const MOTORS = Object.freeze([
  // Drivetrain --------------------------------------------------------------
  { index: 0, name: 'front_left_drive',  hub: 'Control Hub',   port: 0, type: 'goBILDA_312', role: 'drive', wheel: 'FL', aliases: ['left_drive', 'leftFront', 'frontleft'] },
  { index: 1, name: 'front_right_drive', hub: 'Control Hub',   port: 1, type: 'goBILDA_312', role: 'drive', wheel: 'FR', aliases: ['right_drive', 'rightFront', 'frontright'] },
  { index: 2, name: 'back_left_drive',   hub: 'Control Hub',   port: 2, type: 'goBILDA_312', role: 'drive', wheel: 'BL', aliases: ['leftBack', 'backleft', 'left_back_drive'] },
  { index: 3, name: 'back_right_drive',  hub: 'Control Hub',   port: 3, type: 'goBILDA_312', role: 'drive', wheel: 'BR', aliases: ['rightBack', 'backright', 'right_back_drive'] },
  // Mechanisms --------------------------------------------------------------
  { index: 4, name: 'intake',   hub: 'Expansion Hub', port: 0, type: 'goBILDA_435',  role: 'intake' },
  { index: 5, name: 'launcher', hub: 'Expansion Hub', port: 1, type: 'goBILDA_6000', role: 'launcher', aliases: ['shooter', 'flywheel'] },
]);

export const SERVOS = Object.freeze([
  { index: 0, name: 'feeder', hub: 'Control Hub', port: 0, role: 'feeder', kind: 'servo',
    description: 'Pushes one ball from the magazine into the launcher. 0.0 = retracted, 1.0 = fire.' },
  { index: 1, name: 'hood',   hub: 'Control Hub', port: 1, role: 'hood', kind: 'servo',
    description: 'Launch angle. position 0.0 = 20 deg, 1.0 = 60 deg above horizontal.',
    angleRange: [20, 60] },
  { index: 2, name: 'gate',   hub: 'Control Hub', port: 2, role: 'gate', kind: 'crservo',
    description: 'Continuous-rotation servo that agitates the magazine (no physical effect beyond telemetry).' },
]);

export const SENSORS = Object.freeze([
  { name: 'imu', type: 'IMU', hub: 'Control Hub', port: 'I2C 0 (internal)',
    description: 'Control Hub BHI260AP IMU. Yaw (heading), pitch, roll and angular velocity.' },
  { name: 'sensor_distance', type: 'DistanceSensor', hub: 'Control Hub', port: 'I2C 1', aliases: ['distance', 'front_distance'],
    description: 'REV 2m Distance Sensor facing forward from the front of the robot (range 0-78 in).',
    offset: [9, 0], headingDeg: 0, maxRange: 78 },
  { name: 'sensor_color', type: 'ColorSensor', hub: 'Control Hub', port: 'I2C 2', aliases: ['color', 'intake_color'],
    description: 'REV Color Sensor V3 inside the intake. Reports the colour of the last ball and proximity.' },
  { name: 'touch', type: 'TouchSensor', hub: 'Control Hub', port: 'Digital 0', aliases: ['touch_sensor', 'sensor_touch', 'limit'],
    description: 'REV Touch Sensor on the front bumper. Pressed when the bumper contacts a wall or the HIVE frame.' },
  { name: 'Webcam 1', type: 'WebcamName', hub: 'Control Hub', port: 'USB',
    description: 'Logitech C270 on the front of the robot, 12 in above the tiles, tilted up 32 deg. Used by the AprilTag processor to see HIVE CELL tag clusters.',
    offset: [8, 0], heightIn: 12, pitchDeg: 32, hfovDeg: 60, vfovDeg: 46, maxRange: 120 },
]);

/** Physical dimensions of the robot body. */
export const ROBOT_BODY = Object.freeze({
  length: 18,   // along the robot's forward axis (X in robot frame)
  width: 18,
  height: 16,
  massKg: 12,
  wheelDiameterIn: 4.094,   // 104 mm goBILDA mecanum wheels
  trackWidthIn: 14,         // left/right wheel centre distance
  wheelBaseIn: 12,          // front/back wheel centre distance
  driveGearReduction: 1.0,
  strafeEfficiency: 0.9,    // mecanum wheels lose a little speed sideways
  intake: {
    // POLLEN within this box in front of the robot is pulled in while the intake runs
    reachIn: 6, halfWidthIn: 7, capacity: 4, secondsPerBall: 0.35,
    minPower: 0.3,
  },
  launcher: {
    wheelDiameterMm: 96,
    exitHeightIn: 14,
    exitOffsetIn: 6,        // forward of the robot centre
    efficiency: 0.5,        // exit speed / wheel surface speed (single wheel + hood)
    feederFirePosition: 0.7,
    minWheelRpmToFire: 800,
  },
  bumperTouch: { reach: 1.0 },
});

/** Both chassis styles share the same motor ports. */
export const CHASSIS = Object.freeze({
  mecanum: { name: 'Mecanum (4 motors)', wheels: ['FL', 'FR', 'BL', 'BR'] },
  tank: { name: 'Tank (4 motors, 2 per side)', wheels: ['FL', 'FR', 'BL', 'BR'] },
});

/**
 * Two-motor tank names drive both wheels on a side, so the classic SDK
 * samples ("left_drive" / "right_drive") move the whole robot.
 */
export const MOTOR_GANGS = Object.freeze({
  left_drive: [0, 2], right_drive: [1, 3],
  leftDrive: [0, 2], rightDrive: [1, 3],
  left_motor: [0, 2], right_motor: [1, 3],
});

/** Returns the motor spec for a configured name (or alias), with `gang` = all motor indices it drives. */
export function findMotor(name) {
  const spec = MOTORS.find((m) => m.name === name || (m.aliases && m.aliases.includes(name)));
  if (!spec) return null;
  return { ...spec, gang: MOTOR_GANGS[name] || [spec.index] };
}
export function findServo(name) {
  return SERVOS.find((s) => s.name === name) || null;
}
export function findSensor(name) {
  return SENSORS.find((s) => s.name === name || (s.aliases && s.aliases.includes(name))) || null;
}
