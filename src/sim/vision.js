// Simulated webcam + AprilTag processor.
//
// BIOBUZZ puts a cluster of four 3.25 in 36h11 tags on the bottom face of every
// HIVE CELL (Competition Manual 9.9). The SDK's AprilTagProcessor reports each
// cluster as one AprilTagClusterDetection (origin at the centre of the CELL
// opening) plus one AprilTagSingleDetection per visible tag. Because the HIVEs
// pivot, the tags move: they are meant for aiming at a CELL, not for absolute
// field localisation.
//
// ftcPose convention (SDK): x right, y forward, z up, in inches from the camera
// lens; bearing positive to the left; elevation positive up; range straight-line.
import { HIVE, hiveBodyToField } from '../field/geometry.js';
import { findSensor } from './robot-config.js';

const DEG = 180 / Math.PI;
const CAMERA = findSensor('Webcam 1');

/** Field pose + facing normal of each CELL's tag cluster for the current HIVE states. */
export function clusterPoses(hives) {
  const c = HIVE.cell;
  const out = [];
  for (const cl of HIVE.clusters) {
    const upSide = hives[cl.alliance].upSide;
    const isUp = cl.side === upSide;
    const aMid = (c.aIn + c.aOut) / 2;
    const a = isUp ? aMid : -aMid;
    const centerY = HIVE.centerY[cl.alliance];
    const origin = hiveBodyToField(0, a, c.b0, centerY, upSide);
    // outward normal of the bottom face = -b axis of the body frame
    const p0 = hiveBodyToField(0, a, c.b0, centerY, upSide);
    const p1 = hiveBodyToField(0, a, c.b0 - 1, centerY, upSide);
    const n = [p1.x - p0.x, p1.y - p0.y, p1.z - p0.z];
    out.push({ ...cl, isUp, origin, normal: n, tilting: !!hives[cl.alliance].tipping });
  }
  return out;
}

/**
 * Compute the detections the camera would see. Returns an array of records:
 * {id, isCluster, name, x, y, z, yaw, pitch, roll, range, bearing, elevation, percent}
 */
export function computeTagDetections(robot, hives, rng = Math.random) {
  const cam = CAMERA;
  const h = robot.heading;
  const cosH = Math.cos(h), sinH = Math.sin(h);
  const camX = robot.x + cam.offset[0] * cosH - cam.offset[1] * sinH;
  const camY = robot.y + cam.offset[0] * sinH + cam.offset[1] * cosH;
  const camZ = cam.heightIn;
  const pitch = cam.pitchDeg / DEG;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const halfH = cam.hfovDeg / 2, halfV = cam.vfovDeg / 2;

  const toCamera = (px, py, pz) => {
    const dx = px - camX, dy = py - camY, dz = pz - camZ;
    const fwd = dx * cosH + dy * sinH;          // horizontal forward
    const left = -dx * sinH + dy * cosH;
    const y = fwd * cp + dz * sp;               // along the camera axis
    const z = -fwd * sp + dz * cp;              // up in the camera frame
    const x = -left;                            // right
    return { x, y, z, range: Math.hypot(dx, dy, dz) };
  };
  const inFov = (c) => c.y > 1 && Math.abs(Math.atan2(c.x, c.y) * DEG) <= halfH && Math.abs(Math.atan2(c.z, c.y) * DEG) <= halfV;

  const results = [];
  for (const cl of clusterPoses(hives)) {
    if (cl.tilting) continue; // motion blur while the HIVE tips
    const o = cl.origin;
    const dx = camX - o.x, dy = camY - o.y, dz = camZ - o.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > cam.maxRange) continue;
    // the face must be turned toward the camera
    const facing = (cl.normal[0] * dx + cl.normal[1] * dy + cl.normal[2] * dz) / (dist || 1);
    if (facing < 0.2) continue;
    // single tags spaced along the CELL width (field Y)
    const singles = [];
    for (let s = 0; s < 4; s++) {
      const off = HIVE.tagSlotOffsets[s];
      const p = toCamera(o.x, o.y + off, o.z);
      if (inFov(p)) singles.push({ slot: s, id: cl.ids[s], p });
    }
    if (singles.length === 0) continue;
    const yawDeg = tagYaw(cl.normal, h);
    const pitchDeg = Math.asin(Math.max(-1, Math.min(1, cl.normal[2]))) * DEG + cam.pitchDeg;
    const noise = () => (rng() - 0.5) * 0.4;
    const mk = (id, isCluster, name, p, percent) => ({
      id, isCluster, name,
      x: p.x + noise(), y: p.y + noise(), z: p.z + noise(),
      yaw: yawDeg + noise(), pitch: pitchDeg + noise(), roll: noise(),
      range: p.range, bearing: Math.atan2(-p.x, p.y) * DEG + noise() * 0.5,
      elevation: Math.atan2(p.z, Math.hypot(p.x, p.y)) * DEG + noise() * 0.5,
      percent,
    });
    const pc = toCamera(o.x, o.y, o.z);
    results.push(mk(cl.ids[0], true, cl.label, pc, singles.length * 25));
    for (const s of singles) results.push(mk(s.id, false, `${cl.label} slot ${s.slot + 1}`, s.p, 100));
  }
  return results;
}

function tagYaw(normal, robotHeading) {
  // yaw = rotation of the tag about the vertical axis relative to the camera
  // looking straight at it (0 when the tag squarely faces the camera)
  const nh = Math.atan2(normal[1], normal[0]);
  let yaw = (nh - (robotHeading + Math.PI)) * DEG;
  while (yaw > 180) yaw -= 360;
  while (yaw < -180) yaw += 360;
  return yaw;
}
