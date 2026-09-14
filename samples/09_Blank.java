package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;

/*
 * A blank OpMode to start from. Rename the class and the @TeleOp name.
 *
 * Devices you can get from hardwareMap (see the "Robot" tab for the full list):
 *   DcMotor    front_left_drive, front_right_drive, back_left_drive, back_right_drive
 *              left_drive, right_drive (both wheels on a side), intake, launcher
 *   Servo      feeder (0 = back, 1 = fire), hood (0 = 20 deg, 1 = 60 deg)
 *   CRServo    gate
 *   IMU        imu
 *   DistanceSensor sensor_distance      NormalizedColorSensor sensor_color
 *   TouchSensor touch                   WebcamName "Webcam 1"
 */
@TeleOp(name = "My OpMode", group = "5 - Mine")
public class MyOpMode extends LinearOpMode {

    @Override
    public void runOpMode() {
        DcMotor left  = hardwareMap.get(DcMotor.class, "left_drive");
        DcMotor right = hardwareMap.get(DcMotor.class, "right_drive");
        left.setDirection(DcMotor.Direction.REVERSE);

        telemetry.addData("Status", "Initialized");
        telemetry.update();
        waitForStart();

        while (opModeIsActive()) {
            double drive = -gamepad1.left_stick_y;
            double turn  =  gamepad1.right_stick_x;
            left.setPower(drive + turn);
            right.setPower(drive - turn);

            telemetry.addData("left", "%.2f", drive + turn);
            telemetry.addData("right", "%.2f", drive - turn);
            telemetry.update();
        }
    }
}
