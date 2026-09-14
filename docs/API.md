# Supported FTC SDK API

Write OpModes as you would for OnBot Java. `package` and `import` lines are
accepted and ignored. Everything below has the same name and behaviour as the
FTC Robot Controller SDK (10.x / 11.x / 12.0 with AprilTag clusters).

## OpModes

* `LinearOpMode`: `runOpMode()`, `waitForStart()`, `opModeIsActive()`,
  `opModeInInit()`, `isStarted()`, `isStopRequested()`, `sleep(ms)`, `idle()`,
  `getRuntime()`, `resetRuntime()`, `requestOpModeStop()`, `terminateOpModeNow()`
* `OpMode` (iterative): `init()`, `init_loop()`, `start()`, `loop()`, `stop()`, `time`
* Annotations: `@TeleOp(name, group)`, `@Autonomous(name, group, preselectTeleOp)`, `@Disabled`
* Members: `hardwareMap`, `telemetry`, `gamepad1`, `gamepad2`

Loops run at up to 200 Hz (each `opModeIsActive()` or `idle()` waits for one
simulator step, like a hub bus cycle). A loop that never calls
`opModeIsActive()`, `sleep()` or `idle()` cannot be stopped; the Driver
Station restarts the Robot Controller after 2 s, as the real app would.

## hardwareMap

`hardwareMap.get(Type.class, "name")`, `hardwareMap.tryGet(...)`,
`hardwareMap.dcMotor.get("name")`, `.servo.get`, `.crservo.get`,
`.touchSensor.get`, `.colorSensor.get`, `.voltageSensor`, `getAll(...)`.
A wrong name throws the same "Unable to find a hardware device" error as the
SDK and lists the configured devices.

| Name | Type(s) |
| --- | --- |
| `front_left_drive`, `front_right_drive`, `back_left_drive`, `back_right_drive` | `DcMotor`, `DcMotorEx` |
| `left_drive`, `right_drive` (drive both wheels on a side) | `DcMotor`, `DcMotorEx` |
| `intake`, `launcher` | `DcMotor`, `DcMotorEx` |
| `feeder`, `hood` | `Servo`, `ServoImplEx` |
| `gate` | `CRServo` |
| `imu` | `IMU` |
| `sensor_distance` | `DistanceSensor`, `Rev2mDistanceSensor` |
| `sensor_color` | `ColorSensor`, `NormalizedColorSensor`, `RevColorSensorV3` |
| `touch` | `TouchSensor`, `DigitalChannel` |
| `Webcam 1` | `WebcamName` |

## Motors: `DcMotor` / `DcMotorEx`

`setPower`, `getPower`, `setDirection(DcMotor.Direction.FORWARD|REVERSE)`,
`setMode(DcMotor.RunMode.RUN_WITHOUT_ENCODER | RUN_USING_ENCODER | RUN_TO_POSITION | STOP_AND_RESET_ENCODER)`,
`setZeroPowerBehavior(BRAKE|FLOAT)`, `setTargetPosition`, `getTargetPosition`,
`getCurrentPosition`, `isBusy`, `setTargetPositionTolerance`,
`setVelocity(ticksPerSecond)` / `setVelocity(v, AngleUnit)`, `getVelocity(...)`,
`getCurrent(CurrentUnit)`, `getMotorType()`, PIDF setters (accepted, no effect).
`DcMotorSimple.Direction` works too.

Encoder counts per output revolution: drive 537.7 (goBILDA 312), intake
384.5 (goBILDA 435), launcher 28 (goBILDA 6000 bare motor).

## Servos

* `Servo`: `setPosition(0..1)`, `getPosition`, `setDirection`, `scaleRange`.
  Servos move at a finite speed (full travel ≈ 0.4 s).
* `CRServo`: `setPower(-1..1)`, `getPower`, `setDirection`.

## Sensors

* `IMU`: `initialize(new IMU.Parameters(new RevHubOrientationOnRobot(logo, usb)))`,
  `resetYaw()`, `getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES|RADIANS)`,
  `getPitch`, `getRoll`, `getRobotAngularVelocity(AngleUnit)`
  (`xRotationRate`, `yRotationRate`, `zRotationRate`), `getRobotOrientation(...)`.
  Yaw is zero when the OpMode is initialised and counter-clockwise positive.
* `DistanceSensor`: `getDistance(DistanceUnit.MM|CM|METER|INCH)`; range 78 in,
  returns 8190 mm when nothing is in range.
* `ColorSensor`: `red()`, `green()`, `blue()`, `alpha()`, `argb()`, `enableLed`;
  `NormalizedColorSensor`: `getNormalizedColors()` → `NormalizedRGBA`
  (`red`, `green`, `blue`, `alpha`, `toColor()`), `setGain`; `RevColorSensorV3`
  adds `getDistance(unit)`. Reads the last ball collected by the intake.
* `TouchSensor`: `isPressed()`, `getValue()`. `DigitalChannel`: `getState()`
  (false when pressed, as with REV touch sensors).

## Vision

* `VisionPortal.Builder().setCamera(hardwareMap.get(WebcamName.class, "Webcam 1")).addProcessor(p).build()`,
  `VisionPortal.easyCreateWithDefaults(camera, processor)`, `stopStreaming`,
  `resumeStreaming`, `setProcessorEnabled`, `getCameraState`, `close`.
* `AprilTagProcessor.Builder()...build()`, `easyCreateWithDefaults()`,
  `getDetections()`, `getFreshDetections()`, `setDecimation`.
* `AprilTagDetection` with `id`, `metadata.name`, `ftcPose` (`x` right, `y`
  forward, `z` up in inches; `yaw`, `pitch`, `roll`; `range`, `bearing`,
  `elevation` in degrees), `center`, `rawPose`. Detections are either
  `AprilTagSingleDetection` (one tag) or `AprilTagClusterDetection`
  (`percentClusterFound`) — use `instanceof` as in the SDK sample.

## Gamepad

Fields `left_stick_x/y`, `right_stick_x/y`, `left_trigger`, `right_trigger`,
`a b x y`, `dpad_up/down/left/right`, `left_bumper`, `right_bumper`,
`left_stick_button`, `right_stick_button`, `start`, `back`, `guide`;
PlayStation aliases `cross circle square triangle options share`; edge
helpers `aWasPressed()`, `leftBumperWasReleased()`, … ; `rumble(ms)`,
`rumbleBlips(n)`.

## Telemetry

`addData(caption, value)`, `addData(caption, format, args...)`, `addLine(text)`,
`update()`, `clear()`, `clearAll()`, `setAutoClear`, `setMsTransmissionInterval`,
`setCaptionValueSeparator`, `log().add(...)`; items support `setRetained`.

## Utilities

`ElapsedTime` (`reset`, `seconds`, `milliseconds`, `time`, `toString`),
`Range.clip`, `Range.scale`, `AngleUnit.normalizeDegrees/Radians`,
`DistanceUnit`, `CurrentUnit`, `String.format` (`%d %f %.2f %7d %s %x %b %c %n %%`
with flags), `Math.toRadians/toDegrees/signum/hypot/…`, `Integer`, `Double`,
`Boolean`, `System.out.println`, `Thread.sleep`, `ArrayList`/`List`, `HashMap`,
`Arrays.asList`, `StringBuilder`.

## Java language support

Classes with fields, constructors, methods, static fields and methods,
`extends`, simple enums (with constructor arguments, `values()`, `ordinal()`,
`name()`), nested static classes, generics (erased), arrays (`new int[4]`,
`{1, 2, 3}`, 2-D), casts (`(int)` truncates, others are no-ops), `for-each`,
`try/catch/finally`, ternaries, lambdas, `instanceof`, `super(...)`,
`super.method()`, `String.length()`, `.equals`, text blocks. `int`/`long`
declarations and assignments truncate like Java integer arithmetic. Method
overloading by parameter type is not supported (the last definition wins), nor
are anonymous inner classes and interfaces (a warning is shown).

Runtime errors report the Java source line.
