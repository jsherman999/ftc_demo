package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.Servo;
import com.qualcomm.robotcore.util.ElapsedTime;

/*
 * BIOBUZZ autonomous for the RED alliance, audience-side start.
 *
 * The 30 second AUTO period is worth: LEAVE (3), each HIVE TIP (20),
 * PARK in the LOADING ZONE (5). The robot starts against the red wall with
 * 4 POLLEN preloaded and the red HIVE's upward CELL facing the audience.
 *
 * Plan:
 *   1. spin up the launcher while driving forward to the shooting spot
 *   2. turn to face the HIVE, fire the 4 preloads
 *   3. drive to the LOADING ZONE (rear corner by the red wall) and park
 *
 * All distances are in encoder counts converted from inches. Tune SHOOT_POWER
 * and HOOD until the balls land in the CELL, then try to make it faster.
 */
@Autonomous(name = "BIOBUZZ: Auto Shoot + Park (Red)", group = "2 - BIOBUZZ")
public class BioBuzzAuto extends LinearOpMode {

    static final double COUNTS_PER_INCH = 537.7 / (4.094 * Math.PI);
    static final double SHOOT_POWER = 0.43;   // launcher power (fraction of 6000 rpm)
    static final double HOOD        = 1.0;    // 1.0 = 60 degrees

    private DcMotor frontLeft, frontRight, backLeft, backRight, intake;
    private DcMotorEx launcher;
    private Servo feeder, hood;
    private ElapsedTime timer = new ElapsedTime();

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

        frontLeft.setDirection(DcMotor.Direction.REVERSE);
        backLeft.setDirection(DcMotor.Direction.REVERSE);
        for (DcMotor m : new DcMotor[] {frontLeft, frontRight, backLeft, backRight}) {
            m.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
            m.setMode(DcMotor.RunMode.RUN_USING_ENCODER);
            m.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);
        }
        launcher.setMode(DcMotor.RunMode.RUN_USING_ENCODER);
        feeder.setPosition(0);
        hood.setPosition(HOOD);

        telemetry.addData("Status", "Ready (red, audience side start)");
        telemetry.update();
        waitForStart();
        timer.reset();

        // 1. Spin up while moving into position. The HIVE mouth is high (58 in)
        //    so the shot needs a run-up: strafe a little toward the audience
        //    wall (not too far, or the robot cannot turn without hitting it),
        //    then drive forward until level with the HIVE.
        launcher.setPower(SHOOT_POWER);
        drive(0.5, 10, -10, -10, 10, 3.0);        // strafe right 10 in  (also scores LEAVE)
        drive(0.6, 50, 50, 50, 50, 4.0);          // forward 50 in, now level with the HIVE

        // 2. Turn left 90 degrees so the launcher points at the HIVE
        //    (a quarter turn is about 20.4 in of wheel travel on this robot).
        drive(0.4, -20.4, 20.4, -20.4, 20.4, 3.0);

        // 3. Fire the four preloaded POLLEN.
        for (int shot = 0; shot < 4 && opModeIsActive(); shot++) {
            waitForLauncher(SHOOT_POWER * 6000 * 0.9);
            feeder.setPosition(1.0);
            sleep(400);
            feeder.setPosition(0.0);
            sleep(500);
            telemetry.addData("Shots fired", shot + 1);
            telemetry.update();
        }
        launcher.setPower(0);

        // 4. Park: drive across the field toward the rear wall, then strafe
        //    left into the LOADING ZONE (23 in wide, 11 in deep, rear corner
        //    by the red wall).
        drive(0.7, 100, 100, 100, 100, 6.0);      // forward 100 in (toward the rear wall)
        drive(0.5, -46, 46, 46, -46, 4.0);        // strafe left 46 in (toward the red wall)

        telemetry.addData("Auto", "done in %.1f s", timer.seconds());
        telemetry.update();
        sleep(1000);
    }

    /** Spin until the launcher reaches the target speed in rpm (or 2 s pass). */
    private void waitForLauncher(double rpm) {
        ElapsedTime t = new ElapsedTime();
        while (opModeIsActive() && t.seconds() < 2.0 && launcher.getVelocity() / 28.0 * 60.0 < rpm) {
            telemetry.addData("Launcher", "%.0f rpm", launcher.getVelocity() / 28.0 * 60.0);
            telemetry.update();
        }
    }

    /** Move each wheel a number of inches with RUN_TO_POSITION. */
    private void drive(double speed, double fl, double fr, double bl, double br, double timeoutS) {
        if (!opModeIsActive()) return;
        frontLeft.setTargetPosition(frontLeft.getCurrentPosition() + (int) (fl * COUNTS_PER_INCH));
        frontRight.setTargetPosition(frontRight.getCurrentPosition() + (int) (fr * COUNTS_PER_INCH));
        backLeft.setTargetPosition(backLeft.getCurrentPosition() + (int) (bl * COUNTS_PER_INCH));
        backRight.setTargetPosition(backRight.getCurrentPosition() + (int) (br * COUNTS_PER_INCH));
        for (DcMotor m : new DcMotor[] {frontLeft, frontRight, backLeft, backRight}) {
            m.setMode(DcMotor.RunMode.RUN_TO_POSITION);
            m.setPower(speed);
        }
        ElapsedTime t = new ElapsedTime();
        while (opModeIsActive() && t.seconds() < timeoutS &&
               (frontLeft.isBusy() || frontRight.isBusy() || backLeft.isBusy() || backRight.isBusy())) {
            telemetry.addData("Driving", "FL %d FR %d", frontLeft.getCurrentPosition(), frontRight.getCurrentPosition());
            telemetry.update();
        }
        for (DcMotor m : new DcMotor[] {frontLeft, frontRight, backLeft, backRight}) {
            m.setPower(0);
            m.setMode(DcMotor.RunMode.RUN_USING_ENCODER);
        }
        sleep(150);
    }
}
