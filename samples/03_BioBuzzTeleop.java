package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.DistanceSensor;
import com.qualcomm.robotcore.hardware.NormalizedColorSensor;
import com.qualcomm.robotcore.hardware.NormalizedRGBA;
import com.qualcomm.robotcore.hardware.Servo;
import com.qualcomm.robotcore.util.ElapsedTime;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;

/*
 * BIOBUZZ TeleOp for the virtual StarterBot.
 *
 * Driver (gamepad 1):
 *   left stick      drive / strafe (mecanum)      right stick X   turn
 *   right trigger   run the intake (collect POLLEN off the floor)
 *   left trigger    reverse the intake (eject)
 *   A               spin the launcher up / down   B               fire one ball
 *   dpad up/down    raise / lower the hood (launch angle)
 *   bumpers         launcher speed +/- 5 %
 *
 * The HIVE mouth is about 58 in above the tiles and 4-6 ft away from a good
 * shooting spot, so expect to tune the launcher speed and hood angle. The
 * telemetry shows what the sensors see so you can work out what is happening.
 */
@TeleOp(name = "BIOBUZZ: TeleOp", group = "2 - BIOBUZZ")
public class BioBuzzTeleop extends LinearOpMode {

    private DcMotor frontLeft, frontRight, backLeft, backRight;
    private DcMotor intake;
    private DcMotorEx launcher;
    private Servo feeder, hood;
    private DistanceSensor distance;
    private NormalizedColorSensor color;

    private double launcherPower = 0.45;   // fraction of full speed
    private boolean launcherOn = false;
    private double hoodPosition = 0.6;     // 0 = 20 deg, 1 = 60 deg
    private ElapsedTime feederTimer = new ElapsedTime();
    private boolean feederExtended = false;

    @Override
    public void runOpMode() {
        frontLeft  = hardwareMap.get(DcMotor.class, "front_left_drive");
        frontRight = hardwareMap.get(DcMotor.class, "front_right_drive");
        backLeft   = hardwareMap.get(DcMotor.class, "back_left_drive");
        backRight  = hardwareMap.get(DcMotor.class, "back_right_drive");
        intake     = hardwareMap.get(DcMotor.class, "intake");
        launcher   = hardwareMap.get(DcMotorEx.class, "launcher");
        feeder     = hardwareMap.get(Servo.class, "feeder");
        hood       = hardwareMap.get(Servo.class, "hood");
        distance   = hardwareMap.get(DistanceSensor.class, "sensor_distance");
        color      = hardwareMap.get(NormalizedColorSensor.class, "sensor_color");

        // Left side motors face the other way, so reverse them.
        frontLeft.setDirection(DcMotor.Direction.REVERSE);
        backLeft.setDirection(DcMotor.Direction.REVERSE);

        // Use the encoders to hold a consistent launcher speed.
        launcher.setMode(DcMotor.RunMode.RUN_USING_ENCODER);
        for (DcMotor m : new DcMotor[] {frontLeft, frontRight, backLeft, backRight}) {
            m.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);
        }

        feeder.setPosition(0);
        hood.setPosition(hoodPosition);

        telemetry.addData("Status", "Ready. Press START.");
        telemetry.update();
        waitForStart();

        while (opModeIsActive()) {
            // ---- driving -------------------------------------------------
            double forward = -gamepad1.left_stick_y;
            double strafe  =  gamepad1.left_stick_x;
            double turn    =  gamepad1.right_stick_x;

            double fl = forward + strafe + turn;
            double fr = forward - strafe - turn;
            double bl = forward - strafe + turn;
            double br = forward + strafe - turn;
            double max = Math.max(1.0, Math.max(Math.abs(fl), Math.max(Math.abs(fr), Math.max(Math.abs(bl), Math.abs(br)))));
            frontLeft.setPower(fl / max);
            frontRight.setPower(fr / max);
            backLeft.setPower(bl / max);
            backRight.setPower(br / max);

            // ---- intake ----------------------------------------------------
            intake.setPower(gamepad1.right_trigger - gamepad1.left_trigger);

            // ---- launcher ----------------------------------------------------
            if (gamepad1.aWasPressed()) launcherOn = !launcherOn;
            if (gamepad1.rightBumperWasPressed()) launcherPower = Math.min(1.0, launcherPower + 0.05);
            if (gamepad1.leftBumperWasPressed())  launcherPower = Math.max(0.0, launcherPower - 0.05);
            launcher.setPower(launcherOn ? launcherPower : 0);

            if (gamepad1.dpadUpWasPressed())   hoodPosition = Math.min(1.0, hoodPosition + 0.1);
            if (gamepad1.dpadDownWasPressed()) hoodPosition = Math.max(0.0, hoodPosition - 0.1);
            hood.setPosition(hoodPosition);

            // The feeder pushes one ball when it moves from 0 to 1; bring it
            // back after 0.4 s so it is ready for the next shot.
            if (gamepad1.bWasPressed() && !feederExtended) {
                feeder.setPosition(1.0);
                feederExtended = true;
                feederTimer.reset();
            }
            if (feederExtended && feederTimer.seconds() > 0.4) {
                feeder.setPosition(0.0);
                feederExtended = false;
            }

            // ---- telemetry ----------------------------------------------------
            NormalizedRGBA rgba = color.getNormalizedColors();
            telemetry.addData("Launcher", "%s  power %.2f  %.0f rpm", launcherOn ? "ON" : "off",
                    launcherPower, launcher.getVelocity() / 28.0 * 60.0);
            telemetry.addData("Hood", "%.0f deg", 20 + 40 * hoodPosition);
            telemetry.addData("Distance ahead", "%.1f in", distance.getDistance(DistanceUnit.INCH));
            telemetry.addData("Color sensor", "r %.2f g %.2f b %.2f", rgba.red, rgba.green, rgba.blue);
            telemetry.addLine("A launcher on/off | B fire | RT intake | bumpers speed | dpad hood");
            telemetry.update();
        }
    }
}
