package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.util.Range;
import org.firstinspires.ftc.robotcore.external.hardware.camera.WebcamName;
import org.firstinspires.ftc.vision.VisionPortal;
import org.firstinspires.ftc.vision.apriltag.AprilTagClusterDetection;
import org.firstinspires.ftc.vision.apriltag.AprilTagDetection;
import org.firstinspires.ftc.vision.apriltag.AprilTagProcessor;
import org.firstinspires.ftc.vision.apriltag.AprilTagSingleDetection;

import java.util.List;

/*
 * Aim at a HIVE CELL using its AprilTag cluster (based on the SDK samples
 * "Concept: AprilTag Easy" and "Robot: Auto Drive To AprilTag Omni").
 *
 * BIOBUZZ puts a cluster of four 3.25 in tags on the bottom face of every
 * CELL. Because the HIVEs pivot, the tags are for aiming at a CELL rather than
 * for absolute field localisation. Drive around with the sticks; hold the
 * left bumper and the robot turns toward the cluster it sees and drives to
 * DESIRED_DISTANCE from it.
 *
 * The webcam is on the front of the robot, tilted up 32 degrees, so the
 * clusters appear when you are 4-8 ft from the HIVE and facing it.
 */
@TeleOp(name = "BIOBUZZ: AprilTag Aim", group = "2 - BIOBUZZ")
public class AprilTagAim extends LinearOpMode {

    final double DESIRED_DISTANCE = 60.0; // inches from the camera to the cluster
    final double SPEED_GAIN  =  0.02;
    final double TURN_GAIN   =  0.02;
    final double MAX_AUTO_SPEED = 0.5;
    final double MAX_AUTO_TURN  = 0.3;

    private DcMotor frontLeft, frontRight, backLeft, backRight;
    private AprilTagProcessor aprilTag;
    private VisionPortal visionPortal;

    @Override
    public void runOpMode() {
        frontLeft  = hardwareMap.get(DcMotor.class, "front_left_drive");
        frontRight = hardwareMap.get(DcMotor.class, "front_right_drive");
        backLeft   = hardwareMap.get(DcMotor.class, "back_left_drive");
        backRight  = hardwareMap.get(DcMotor.class, "back_right_drive");
        frontLeft.setDirection(DcMotor.Direction.REVERSE);
        backLeft.setDirection(DcMotor.Direction.REVERSE);

        initAprilTag();

        telemetry.addData("Camera", "streaming. Hold left bumper to auto-aim.");
        telemetry.update();
        waitForStart();

        while (opModeIsActive()) {
            AprilTagDetection target = null;
            List<AprilTagDetection> detections = aprilTag.getDetections();
            for (AprilTagDetection d : detections) {
                if (d instanceof AprilTagClusterDetection) {
                    target = d;   // clusters give the pose of the CELL opening
                }
            }

            double drive = 0, strafe = 0, turn = 0;
            if (gamepad1.left_bumper && target != null) {
                double rangeError   = target.ftcPose.range - DESIRED_DISTANCE;
                double headingError = target.ftcPose.bearing;
                drive = Range.clip(rangeError * SPEED_GAIN, -MAX_AUTO_SPEED, MAX_AUTO_SPEED);
                turn  = Range.clip(-headingError * TURN_GAIN, -MAX_AUTO_TURN, MAX_AUTO_TURN);
                telemetry.addData("Auto", "range err %.1f in, bearing %.1f deg", rangeError, headingError);
            } else {
                drive  = -gamepad1.left_stick_y;
                strafe =  gamepad1.left_stick_x;
                turn   =  gamepad1.right_stick_x;
            }
            moveRobot(drive, strafe, turn);

            telemetry.addData("# detections", detections.size());
            for (AprilTagDetection d : detections) {
                if (d instanceof AprilTagClusterDetection) {
                    AprilTagClusterDetection c = (AprilTagClusterDetection) d;
                    telemetry.addLine(String.format("CLUSTER %s  %d%% found", c.metadata.name, c.percentClusterFound));
                    telemetry.addLine(String.format("  range %.1f in  bearing %.1f  elev %.1f", c.ftcPose.range, c.ftcPose.bearing, c.ftcPose.elevation));
                } else {
                    AprilTagSingleDetection s = (AprilTagSingleDetection) d;
                    telemetry.addLine(String.format("  tag %d  x %.1f y %.1f z %.1f", s.id, s.ftcPose.x, s.ftcPose.y, s.ftcPose.z));
                }
            }
            telemetry.update();
            sleep(20);
        }
        visionPortal.close();
    }

    private void initAprilTag() {
        aprilTag = new AprilTagProcessor.Builder()
                .setDrawTagID(true)
                .setDrawTagOutline(true)
                .build();
        visionPortal = new VisionPortal.Builder()
                .setCamera(hardwareMap.get(WebcamName.class, "Webcam 1"))
                .addProcessor(aprilTag)
                .build();
    }

    private void moveRobot(double x, double y, double yaw) {
        double fl = x + y + yaw;
        double fr = x - y - yaw;
        double bl = x - y + yaw;
        double br = x + y - yaw;
        double max = Math.max(Math.abs(fl), Math.abs(fr));
        max = Math.max(max, Math.abs(bl));
        max = Math.max(max, Math.abs(br));
        if (max > 1.0) {
            fl /= max; fr /= max; bl /= max; br /= max;
        }
        frontLeft.setPower(fl);
        frontRight.setPower(fr);
        backLeft.setPower(bl);
        backRight.setPower(br);
    }
}
