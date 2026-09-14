package org.firstinspires.ftc.teamcode;

import com.qualcomm.hardware.rev.RevHubOrientationOnRobot;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DistanceSensor;
import com.qualcomm.robotcore.hardware.IMU;
import com.qualcomm.robotcore.hardware.NormalizedColorSensor;
import com.qualcomm.robotcore.hardware.NormalizedRGBA;
import com.qualcomm.robotcore.hardware.TouchSensor;
import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;

/*
 * A tour of the sensors on the virtual robot.
 *
 * The robot drives forward until the distance sensor sees something closer
 * than STOP_DISTANCE, then backs up, turns 90 degrees using the IMU and
 * repeats. Press STOP to end. While driving, the telemetry shows every sensor:
 *
 *   sensor_distance   REV 2m distance sensor on the front (inches)
 *   sensor_color      REV Color Sensor V3 inside the intake
 *   touch             REV touch sensor on the front bumper
 *   imu               heading (yaw), pitch, roll and the turn rate
 */
@Autonomous(name = "Sensor: Tour", group = "4 - Sensors")
public class SensorTour extends LinearOpMode {

    static final double STOP_DISTANCE = 12.0;  // inches

    private DcMotor leftDrive, rightDrive, intake;
    private DistanceSensor distance;
    private NormalizedColorSensor color;
    private TouchSensor touch;
    private IMU imu;

    @Override
    public void runOpMode() {
        leftDrive  = hardwareMap.get(DcMotor.class, "left_drive");
        rightDrive = hardwareMap.get(DcMotor.class, "right_drive");
        intake     = hardwareMap.get(DcMotor.class, "intake");
        distance   = hardwareMap.get(DistanceSensor.class, "sensor_distance");
        color      = hardwareMap.get(NormalizedColorSensor.class, "sensor_color");
        touch      = hardwareMap.get(TouchSensor.class, "touch");
        imu        = hardwareMap.get(IMU.class, "imu");

        leftDrive.setDirection(DcMotor.Direction.REVERSE);
        imu.initialize(new IMU.Parameters(new RevHubOrientationOnRobot(
                RevHubOrientationOnRobot.LogoFacingDirection.UP,
                RevHubOrientationOnRobot.UsbFacingDirection.FORWARD)));

        while (opModeInInit()) {
            showSensors("Waiting for START");
        }
        imu.resetYaw();

        while (opModeIsActive()) {
            // run the intake so any POLLEN we bump into gets collected
            intake.setPower(1.0);

            // drive forward until something is close
            leftDrive.setPower(0.4);
            rightDrive.setPower(0.4);
            while (opModeIsActive() && distance.getDistance(DistanceUnit.INCH) > STOP_DISTANCE && !touch.isPressed()) {
                showSensors("Driving forward");
            }

            // back up a little
            leftDrive.setPower(-0.4);
            rightDrive.setPower(-0.4);
            sleep(600);

            // turn 90 degrees to the left using the IMU
            double startYaw = imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES);
            leftDrive.setPower(-0.3);
            rightDrive.setPower(0.3);
            while (opModeIsActive() && turned(startYaw) < 88) {
                showSensors("Turning");
            }
            leftDrive.setPower(0);
            rightDrive.setPower(0);
            sleep(300);
        }
    }

    private double turned(double startYaw) {
        double yaw = imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES);
        return AngleUnit.normalizeDegrees(yaw - startYaw);
    }

    private void showSensors(String status) {
        NormalizedRGBA rgba = color.getNormalizedColors();
        String seen = "nothing";
        if (rgba.alpha > 0.5) {
            if (rgba.red > 0.5 && rgba.green > 0.5) seen = "POLLEN (yellow)";
            else if (rgba.red > 0.5) seen = "red NECTAR";
            else if (rgba.blue > 0.5) seen = "blue NECTAR";
        }
        telemetry.addData("Status", status);
        telemetry.addData("Distance", "%.1f in", distance.getDistance(DistanceUnit.INCH));
        telemetry.addData("Touch", touch.isPressed() ? "PRESSED" : "released");
        telemetry.addData("Color", "%s  (r %.2f g %.2f b %.2f)", seen, rgba.red, rgba.green, rgba.blue);
        telemetry.addData("Yaw", "%.1f deg   rate %.1f deg/s",
                imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES),
                imu.getRobotAngularVelocity(AngleUnit.DEGREES).zRotationRate);
        telemetry.update();
    }
}
