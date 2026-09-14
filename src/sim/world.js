// The BIOBUZZ world: one robot, 40 POLLEN, 16 NECTAR, two HIVEs, four FLOWERs.
//
// Everything is in inches / seconds in the FTC field coordinate frame (see
// field/geometry.js). The simulator advances in fixed steps; each step it
// reads commands from shared memory, integrates motors, robot and balls, then
// writes every sensor back so the OpMode runtime sees a fresh "bus" read.
import {
  FIELD, HIVE, FLOWER, LOADING_ZONE, GARDEN, START_POSES, POLLEN, NECTAR,
  NECTAR_POLLEN_EQUIV, fieldToHiveBody, hiveBodyToField, cellPentagon, pointInPolygon,
  robotObstacles, wallPolygons, rectContains, polygonOverlapsRect,
} from '../field/geometry.js';
import { MATCH, POINTS, LIMITS, ASSUMPTIONS, scoreFlower, tallyAlliance } from '../field/rules.js';
import { MOTORS, SERVOS, ROBOT_BODY, findSensor } from './robot-config.js';
import { MotorModel } from './motor-model.js';
import { I, F, RunMode, TAG_STRIDE, MAX_TAGS, MAX_MOTORS, MAX_SERVOS } from './shared-memory.js';
import * as C from './collision.js';
import { computeTagDetections } from './vision.js';

const G = 386.09;          // in/s^2
const DRAG = 0.0011;       // 1/in  (0.5 * rho * Cd * A / m for a POLLEN)
const DEG = 180 / Math.PI;
const PENTAGON = cellPentagon();

let nextBallId = 1;

function makeBall(kind, alliance, x, y, z = 0) {
  const spec = kind === 'nectar' ? NECTAR : POLLEN;
  return {
    id: nextBallId++, kind, alliance, x, y, z, vx: 0, vy: 0, vz: 0,
    r: spec.radius, state: 'floor', spin: 0,
  };
}

export class World {
  constructor(opts = {}) {
    this.opts = {
      alliance: 'red',
      chassis: 'mecanum',
      startPose: 0,
      preload: 4,
      tipMass: ASSUMPTIONS.tipMassPollenEquiv,
      otherRobotPreloads: true,
      ...opts,
    };
    this.rng = opts.rng || Math.random;
    this.views = null;
    this.reset();
  }

  // ---------------------------------------------------------------------------
  reset() {
    const o = this.opts;
    this.time = 0;
    this.opModeTime = 0;
    this.phase = 'practice';     // practice | auto | transition | teleop | finished
    this.phaseTime = 0;
    this.events = [];
    this.alliance = o.alliance;
    this.stepCount = 0;

    const start = START_POSES[o.alliance][o.startPose] || START_POSES[o.alliance][0];
    this.startPose = start;
    this.robot = {
      x: start.x, y: start.y, heading: start.headingDeg / DEG,
      vx: 0, vy: 0, omega: 0,
      magazine: [],            // balls carried (max 4)
      intakeCooldown: 0,
      ejectCooldown: 0,
      frontContact: false,
      yawOffset: start.headingDeg,
      left: false, parkedAuto: false, parkedTeleop: false,
      lastFeeder: 0,
    };
    this.motors = MOTORS.map((m) => new MotorModel(m));
    this.servos = SERVOS.map((s) => ({ spec: s, cmd: s.kind === 'crservo' ? 0 : 0, actual: 0, reversed: false }));
    this.hives = {
      red: { upSide: HIVE.startUpSide.red, upCell: [], tips: 0, tipping: null },
      blue: { upSide: HIVE.startUpSide.blue, upCell: [], tips: 0, tipping: null },
    };
    this.flowers = FLOWER.list.map((f) => ({ spec: f, stack: [] }));
    this.nectarOffField = { red: LIMITS.nectarOffField, blue: LIMITS.nectarOffField };
    this.nectarUnlocked = { red: 0, blue: 0 };
    this.balls = [];
    this.obstacles = [...wallPolygons(), ...robotObstacles(ROBOT_BODY.height)];
    this.tags = [];
    this.visionEnabled = false;
    this.stageElements();
    this.log('Field reset. ' + this.balls.length + ' scoring elements staged.');
  }

  stageElements() {
    const o = this.opts;
    // 4 POLLEN in each FLOWER
    for (const fl of this.flowers) {
      for (let k = 0; k < FLOWER.startPollen; k++) {
        const b = makeBall('pollen', null, fl.spec.x, fl.spec.y, 0);
        b.state = 'flower';
        fl.stack.push(b);
        this.balls.push(b);
      }
    }
    // 4 POLLEN in each GARDEN (against the audience wall in the corner)
    for (const alliance of ['red', 'blue']) {
      const g = GARDEN[alliance];
      const r = POLLEN.radius;
      for (let k = 0; k < GARDEN.startPollen; k++) {
        const x = alliance === 'red' ? FIELD.half - r : -FIELD.half + r;
        const y = alliance === 'red' ? g.y0 + r + 0.5 + k * (2 * r + 1.2) : g.y1 - r - 0.5 - k * (2 * r + 1.2);
        this.balls.push(makeBall('pollen', null, x, y));
      }
    }
    // 3 NECTAR in each upward CELL
    for (const alliance of ['red', 'blue']) {
      for (let k = 0; k < LIMITS.nectarStagedInCell; k++) {
        const b = makeBall('nectar', alliance, 0, HIVE.centerY[alliance], HIVE.cell.lipZ);
        b.state = 'cell';
        this.hives[alliance].upCell.push(b);
        this.balls.push(b);
      }
    }
    // our preload
    for (let k = 0; k < Math.min(o.preload, LIMITS.possession); k++) {
      const b = makeBall('pollen', null, this.robot.x, this.robot.y);
      b.state = 'robot';
      this.robot.magazine.push(b);
      this.balls.push(b);
    }
    // the other three robots' preloads sit on the floor at their start spots
    if (o.otherRobotPreloads) {
      const poses = [...START_POSES.red, ...START_POSES.blue].filter((p) => p !== this.startPose);
      for (const p of poses) {
        for (let k = 0; k < 4; k++) {
          const b = makeBall('pollen', null, p.x - 6 + (k % 2) * 4, p.y + (k < 2 ? -3 : 3));
          this.balls.push(b);
        }
      }
    }
    // remaining POLLEN (if fewer than 40 were staged) sits in the alliance areas: not modelled
  }

  log(text) {
    this.events.push({ t: this.time, text });
    if (this.events.length > 200) this.events.shift();
  }

  attachShared(views) { this.views = views; }

  // ---------------------------------------------------------------------------
  // Match control
  startPhase(phase) {
    this.phase = phase;
    this.phaseTime = 0;
    if (phase === 'auto') {
      this.robot.left = false;
      this.robot.parkedAuto = false;
    }
    this.log(`${phase.toUpperCase()} started`);
  }

  endPhase() {
    if (this.phase === 'auto') {
      this.robot.parkedAuto = this.robotInLoadingZone();
      this.log(`AUTO ended: LEAVE=${this.robot.left} PARK=${this.robot.parkedAuto}`);
    } else if (this.phase === 'teleop') {
      this.robot.parkedTeleop = this.robotInLoadingZone();
      this.log(`MATCH ended: PARK=${this.robot.parkedTeleop}`);
    }
  }

  robotInLoadingZone() {
    const r = this.robot;
    const corners = C.robotCorners(r.x, r.y, r.heading, ROBOT_BODY.length, ROBOT_BODY.width);
    return polygonOverlapsRect(corners, LOADING_ZONE[this.alliance]);
  }

  /** Human player action: put a staged NECTAR into the LOADING ZONE (G426). */
  loadNectar(alliance = this.alliance) {
    const flood = this.phase === 'teleop' && (MATCH.teleopSeconds - this.phaseTime) <= MATCH.nectarFloodAt;
    if (this.nectarOffField[alliance] <= 0) { this.log('No NECTAR left to load'); return false; }
    if (this.nectarUnlocked[alliance] <= 0 && !flood && this.phase !== 'practice') {
      this.log('NECTAR is unlocked one per HIVE TIP (all with 60 s left)');
      return false;
    }
    const z = LOADING_ZONE[alliance];
    const b = makeBall('nectar', alliance, z.x0 + 3 + this.rng() * (z.x1 - z.x0 - 6), z.y0 + 3 + this.rng() * (z.y1 - z.y0 - 6));
    this.balls.push(b);
    this.nectarOffField[alliance]--;
    if (this.nectarUnlocked[alliance] > 0) this.nectarUnlocked[alliance]--;
    this.log(`${alliance} NECTAR loaded into the LOADING ZONE`);
    return true;
  }

  setRobotPose(x, y, headingDeg) {
    const r = this.robot;
    r.x = x; r.y = y; r.heading = headingDeg / DEG; r.vx = r.vy = r.omega = 0;
  }

  // ---------------------------------------------------------------------------
  step(dt) {
    this.time += dt;
    this.phaseTime += dt;
    this.stepCount++;
    this.readCommands();
    for (const m of this.motors) m.step(dt);
    this.stepServos(dt);
    this.stepRobot(dt);
    this.stepMechanisms(dt);
    this.stepBalls(dt);
    this.stepHives(dt);
    this.updateFlags();
    if (this.visionEnabled && this.stepCount % 8 === 0) {
      this.tags = computeTagDetections(this.robot, this.hives, this.rng);
    } else if (!this.visionEnabled) this.tags = [];
    this.writeSensors();
  }

  readCommands() {
    if (!this.views) return;
    const { i32, f64 } = this.views;
    for (let i = 0; i < this.motors.length; i++) {
      const m = this.motors[i];
      m.power = f64[F.MOTOR_POWER_BASE + i] || 0;
      const vs = f64[F.MOTOR_VELOCITY_BASE + i];
      m.velocitySetpoint = Number.isNaN(vs) ? null : vs;
      m.mode = i32[I.MOTOR_MODE_BASE + i];
      m.reversed = i32[I.MOTOR_DIR_BASE + i] === 1;
      m.brake = i32[I.MOTOR_ZPB_BASE + i] === 1;
      m.targetPosition = i32[I.MOTOR_TARGET_BASE + i];
      const req = i32[I.MOTOR_RESET_BASE + i];
      if (req !== i32[I.MOTOR_RESET_ACK_BASE + i]) {
        m.resetEncoder();
        i32[I.MOTOR_RESET_ACK_BASE + i] = req;
      }
    }
    for (let s = 0; s < this.servos.length; s++) {
      const sv = this.servos[s];
      sv.cmd = f64[F.SERVO_POS_BASE + s] || 0;
      sv.reversed = i32[I.SERVO_DIR_BASE + s] === 1;
    }
    this.visionEnabled = i32[I.VISION_ENABLED] === 1;
    const yawReq = i32[I.IMU_RESET_YAW];
    if (yawReq !== i32[I.IMU_RESET_ACK]) {
      this.robot.yawOffset = this.robot.heading * DEG;
      i32[I.IMU_RESET_ACK] = yawReq;
    }
  }

  stepServos(dt) {
    for (const sv of this.servos) {
      if (sv.spec.kind === 'crservo') {
        // continuous rotation: "actual" accumulates turns for telemetry only
        const p = sv.reversed ? -sv.cmd : sv.cmd;
        sv.actual += p * dt;
        continue;
      }
      let target = Math.max(0, Math.min(1, sv.cmd));
      if (sv.reversed) target = 1 - target;
      const speed = 2.5; // full travel in 0.4 s
      const d = target - sv.actual;
      const stepMax = speed * dt;
      sv.actual += Math.abs(d) <= stepMax ? d : Math.sign(d) * stepMax;
    }
  }

  wheelSurfaceSpeeds() {
    const r = ROBOT_BODY.wheelDiameterIn / 2;
    // left-side motors are mirrored: positive shaft rotation drives the wheel backwards
    const side = { FL: -1, FR: 1, BL: -1, BR: 1 };
    const v = {};
    for (let i = 0; i < 4; i++) {
      const m = this.motors[i];
      v[m.spec.wheel] = side[m.spec.wheel] * m.omega * r / ROBOT_BODY.driveGearReduction;
    }
    return v;
  }

  stepRobot(dt) {
    const rb = this.robot;
    const v = this.wheelSurfaceSpeeds();
    let vf, vl, om;
    if (this.opts.chassis === 'tank') {
      const vL = (v.FL + v.BL) / 2, vR = (v.FR + v.BR) / 2;
      vf = (vL + vR) / 2; vl = 0; om = (vR - vL) / ROBOT_BODY.trackWidthIn;
    } else {
      vf = (v.FL + v.FR + v.BL + v.BR) / 4;
      vl = (-v.FL + v.FR + v.BL - v.BR) / 4 * ROBOT_BODY.strafeEfficiency;
      om = (-v.FL + v.FR - v.BL + v.BR) / (4 * (ROBOT_BODY.trackWidthIn + ROBOT_BODY.wheelBaseIn) / 2);
    }
    // desired field-frame velocity
    const c = Math.cos(rb.heading), s = Math.sin(rb.heading);
    const dvx = vf * c - vl * s, dvy = vf * s + vl * c;
    // traction-limited approach to the wheel velocity
    const aMax = 420, alphaMax = 60;
    const ax = dvx - rb.vx, ay = dvy - rb.vy;
    const an = Math.hypot(ax, ay);
    const lim = aMax * dt;
    if (an > lim) { rb.vx += ax / an * lim; rb.vy += ay / an * lim; } else { rb.vx = dvx; rb.vy = dvy; }
    const dom = om - rb.omega;
    const olim = alphaMax * dt;
    rb.omega += Math.abs(dom) > olim ? Math.sign(dom) * olim : dom;

    rb.x += rb.vx * dt;
    rb.y += rb.vy * dt;
    rb.heading += rb.omega * dt;
    rb.heading = C.normalizeAngle(rb.heading);
    this.collideRobot();
  }

  collideRobot() {
    const rb = this.robot;
    rb.frontContact = false;
    for (let iter = 0; iter < 3; iter++) {
      const corners = C.robotCorners(rb.x, rb.y, rb.heading, ROBOT_BODY.length, ROBOT_BODY.width);
      let any = false;
      for (const ob of this.obstacles) {
        const mtv = C.polygonMTV(corners, ob.poly);
        if (!mtv) continue;
        any = true;
        rb.x += mtv.nx * mtv.depth;
        rb.y += mtv.ny * mtv.depth;
        // remove the velocity component into the obstacle
        const vn = rb.vx * mtv.nx + rb.vy * mtv.ny;
        if (vn < 0) { rb.vx -= vn * mtv.nx; rb.vy -= vn * mtv.ny; }
        rb.omega *= 0.6;
        const fwdDot = Math.cos(rb.heading) * mtv.nx + Math.sin(rb.heading) * mtv.ny;
        if (fwdDot < -0.6) rb.frontContact = true;
        break;
      }
      if (!any) break;
    }
  }

  // ---------------------------------------------------------------------------
  stepMechanisms(dt) {
    const rb = this.robot;
    const intake = this.motors[4];
    const launcher = this.motors[5];
    const c = Math.cos(rb.heading), s = Math.sin(rb.heading);
    const drive = intake.drive();
    rb.intakeCooldown = Math.max(0, rb.intakeCooldown - dt);
    rb.ejectCooldown = Math.max(0, rb.ejectCooldown - dt);
    const cfg = ROBOT_BODY.intake;

    if (drive > cfg.minPower && rb.magazine.length < cfg.capacity && rb.intakeCooldown === 0) {
      // any floor ball in the intake zone?
      for (const b of this.balls) {
        if (b.state !== 'floor') continue;
        const dx = b.x - rb.x, dy = b.y - rb.y;
        const lx = dx * c + dy * s, ly = -dx * s + dy * c;
        if (lx > ROBOT_BODY.length / 2 - 2 && lx < ROBOT_BODY.length / 2 + cfg.reachIn && Math.abs(ly) < cfg.halfWidthIn) {
          if (b.kind === 'nectar' && b.alliance !== this.alliance) {
            continue; // G408: a ROBOT may not CONTROL the opponent's NECTAR
          }
          b.state = 'robot';
          b.vx = b.vy = b.vz = 0;
          rb.magazine.push(b);
          rb.intakeCooldown = cfg.secondsPerBall;
          this.log(`Intake collected ${b.kind.toUpperCase()} (${rb.magazine.length} in robot)`);
          break;
        }
      }
      // pull from a FLOWER's bottom retrieval opening
      if (rb.intakeCooldown === 0) {
        for (const fl of this.flowers) {
          if (fl.stack.length === 0) continue;
          const dx = fl.spec.x - rb.x, dy = fl.spec.y - rb.y;
          const lx = dx * c + dy * s, ly = -dx * s + dy * c;
          if (lx > ROBOT_BODY.length / 2 - 2 && lx < ROBOT_BODY.length / 2 + cfg.reachIn + 2 && Math.abs(ly) < cfg.halfWidthIn) {
            const b = fl.stack[0];
            if (b.kind === 'nectar' && b.alliance !== this.alliance) continue;
            fl.stack.shift();
            b.state = 'robot';
            rb.magazine.push(b);
            rb.intakeCooldown = cfg.secondsPerBall * 2;
            this.log(`Intake pulled ${b.kind.toUpperCase()} from the bottom of ${fl.spec.name}`);
            break;
          }
        }
      }
    } else if (drive < -cfg.minPower && rb.magazine.length > 0 && rb.ejectCooldown === 0) {
      const b = rb.magazine.shift();
      this.releaseBall(b, rb.x + c * (ROBOT_BODY.length / 2 + b.r + 1), rb.y + s * (ROBOT_BODY.length / 2 + b.r + 1), 2,
        c * 40 + rb.vx, s * 40 + rb.vy, 5);
      rb.ejectCooldown = cfg.secondsPerBall;
      this.log(`Intake ejected ${b.kind.toUpperCase()}`);
    }

    // launcher: feeder servo rising through the fire position pushes one ball
    const feeder = this.servos[0];
    const hood = this.servos[1];
    const L = ROBOT_BODY.launcher;
    const fired = rb.lastFeeder < L.feederFirePosition && feeder.actual >= L.feederFirePosition;
    rb.lastFeeder = feeder.actual;
    if (fired && rb.magazine.length > 0) {
      const b = rb.magazine.shift();
      const rpm = launcher.rpm;
      const ex = rb.x + c * L.exitOffsetIn, ey = rb.y + s * L.exitOffsetIn;
      if (rpm >= L.minWheelRpmToFire) {
        const surface = rpm / 60 * Math.PI * (L.wheelDiameterMm / 25.4);   // in/s
        const speed = surface * L.efficiency * (1 + (this.rng() - 0.5) * 0.04);
        const angleRange = hood.spec.angleRange;
        const ang = (angleRange[0] + (angleRange[1] - angleRange[0]) * hood.actual) / DEG;
        const yawNoise = (this.rng() - 0.5) * 1.5 / DEG;
        const hc = Math.cos(rb.heading + yawNoise), hs = Math.sin(rb.heading + yawNoise);
        this.releaseBall(b, ex, ey, L.exitHeightIn,
          hc * speed * Math.cos(ang) + rb.vx, hs * speed * Math.cos(ang) + rb.vy, speed * Math.sin(ang));
        launcher.omega *= 0.86; // the wheel gives energy to the ball
        this.log(`Launched ${b.kind.toUpperCase()} at ${speed.toFixed(0)} in/s, ${(ang * DEG).toFixed(0)} deg (wheel ${rpm.toFixed(0)} rpm)`);
      } else {
        this.releaseBall(b, ex + c * 3, ey + s * 3, L.exitHeightIn, c * 15 + rb.vx, s * 15 + rb.vy, 0);
        this.log(`Feeder pushed a ball but the launcher wheel is too slow (${rpm.toFixed(0)} rpm)`);
      }
    }
  }

  releaseBall(b, x, y, z, vx, vy, vz) {
    b.state = 'flight';
    b.x = x; b.y = y; b.z = z; b.vx = vx; b.vy = vy; b.vz = vz;
  }

  // ---------------------------------------------------------------------------
  stepBalls(dt) {
    const rb = this.robot;
    const corners = C.robotCorners(rb.x, rb.y, rb.heading, ROBOT_BODY.length, ROBOT_BODY.width);
    for (const b of this.balls) {
      if (b.state === 'floor') this.stepFloorBall(b, dt, corners);
      else if (b.state === 'flight') this.stepFlightBall(b, dt);
    }
    // ball-ball separation on the floor
    const floor = this.balls.filter((b) => b.state === 'floor');
    for (let i = 0; i < floor.length; i++) {
      for (let j = i + 1; j < floor.length; j++) {
        const a = floor[i], b = floor[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy), min = a.r + b.r;
        if (d < min && d > 1e-6) {
          const push = (min - d) / 2;
          const nx = dx / d, ny = dy / d;
          a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
          const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rel < 0) {
            const jimp = -rel * 0.8;
            a.vx -= nx * jimp; a.vy -= ny * jimp; b.vx += nx * jimp; b.vy += ny * jimp;
          }
        }
      }
    }
  }

  stepFloorBall(b, dt, robotCorners) {
    const speed = Math.hypot(b.vx, b.vy);
    if (speed > 0) {
      const decel = 14 * dt;   // rolling resistance on foam tiles
      const ns = Math.max(0, speed - decel) * Math.exp(-0.6 * dt);
      b.vx *= ns / speed; b.vy *= ns / speed;
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
    b.z = 0;
    // walls
    const lim = FIELD.half - b.r;
    if (b.x > lim) { b.x = lim; b.vx = -Math.abs(b.vx) * 0.5; }
    if (b.x < -lim) { b.x = -lim; b.vx = Math.abs(b.vx) * 0.5; }
    if (b.y > lim) { b.y = lim; b.vy = -Math.abs(b.vy) * 0.5; }
    if (b.y < -lim) { b.y = -lim; b.vy = Math.abs(b.vy) * 0.5; }
    // field obstacles (HIVE legs, foot bars, FLOWER boxes)
    for (const ob of this.obstacles) {
      if (ob.name.startsWith('wall')) continue;
      const mtv = C.circlePolygonMTV(b.x, b.y, b.r, ob.poly);
      if (mtv) {
        b.x += mtv.nx * mtv.depth; b.y += mtv.ny * mtv.depth;
        const vn = b.vx * mtv.nx + b.vy * mtv.ny;
        if (vn < 0) { b.vx -= 1.5 * vn * mtv.nx; b.vy -= 1.5 * vn * mtv.ny; }
      }
    }
    // robot pushes balls
    const mtv = C.circlePolygonMTV(b.x, b.y, b.r, robotCorners);
    if (mtv) {
      const rb = this.robot;
      b.x += mtv.nx * mtv.depth; b.y += mtv.ny * mtv.depth;
      // velocity of the robot edge at the contact point
      const rx = b.x - rb.x, ry = b.y - rb.y;
      const evx = rb.vx - rb.omega * ry, evy = rb.vy + rb.omega * rx;
      const vn = (b.vx - evx) * mtv.nx + (b.vy - evy) * mtv.ny;
      if (vn < 0) { b.vx -= vn * mtv.nx * 1.2; b.vy -= vn * mtv.ny * 1.2; }
      // keep moving with the robot at least
      const en = evx * mtv.nx + evy * mtv.ny;
      const bn = b.vx * mtv.nx + b.vy * mtv.ny;
      if (bn < en) { b.vx += (en - bn) * mtv.nx; b.vy += (en - bn) * mtv.ny; }
    }
  }

  stepFlightBall(b, dt) {
    const prev = { x: b.x, y: b.y, z: b.z };
    const speed = Math.hypot(b.vx, b.vy, b.vz);
    const k = DRAG * speed;
    b.vx -= k * b.vx * dt; b.vy -= k * b.vy * dt;
    b.vz -= (G + k * b.vz) * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;

    // HIVE interaction
    if (Math.abs(b.x) < 34 && Math.abs(b.y) < 40 && b.z > 20) {
      if (this.hiveInteract(b, prev)) return;
    }
    // FLOWER opening
    if (b.vz < 0 && prev.z >= FLOWER.openingZ && b.z < FLOWER.openingZ) {
      for (const fl of this.flowers) {
        const d = Math.hypot(b.x - fl.spec.x, b.y - fl.spec.y);
        const horiz = Math.hypot(b.vx, b.vy);
        if (d < FLOWER.openingDiameter / 2 + 1.0 && horiz < 90 && this.flowerHasRoom(fl, b)) {
          b.state = 'flower'; b.vx = b.vy = b.vz = 0; b.x = fl.spec.x; b.y = fl.spec.y; b.z = 0;
          fl.stack.push(b);
          this.log(`${b.kind.toUpperCase()} scored in ${fl.spec.name} (${fl.stack.length} in stack)`);
          return;
        }
      }
    }
    // perimeter walls
    const lim = FIELD.half - b.r;
    if (Math.abs(b.x) > lim || Math.abs(b.y) > lim) {
      if (b.z < FIELD.wallHeight + b.r) {
        if (b.x > lim) { b.x = lim; b.vx = -Math.abs(b.vx) * 0.4; }
        if (b.x < -lim) { b.x = -lim; b.vx = Math.abs(b.vx) * 0.4; }
        if (b.y > lim) { b.y = lim; b.vy = -Math.abs(b.vy) * 0.4; }
        if (b.y < -lim) { b.y = -lim; b.vy = Math.abs(b.vy) * 0.4; }
      } else if (Math.abs(b.x) > FIELD.half + 6 || Math.abs(b.y) > FIELD.half + 6) {
        b.state = 'off';
        this.log(`${b.kind.toUpperCase()} left the FIELD`);
        return;
      }
    }
    // floor
    if (b.z <= 0) {
      b.z = 0;
      if (Math.abs(b.vz) > 25) {
        b.vz = -b.vz * 0.45; b.vx *= 0.75; b.vy *= 0.75;
      } else {
        b.vz = 0; b.state = 'floor';
        // clamp inside the field
        b.x = Math.max(-lim, Math.min(lim, b.x)); b.y = Math.max(-lim, Math.min(lim, b.y));
      }
    }
  }

  flowerHasRoom(fl, b) {
    let h = 0;
    for (const e of fl.stack) h += 2 * e.r;
    return h + 2 * b.r <= FLOWER.scoringHeight + 4;
  }

  /** Returns true if the ball was captured (scored) or absorbed; bounces otherwise. */
  hiveInteract(b, prev) {
    const c = HIVE.cell;
    for (const alliance of ['red', 'blue']) {
      const h = this.hives[alliance];
      const cy = HIVE.centerY[alliance];
      if (Math.abs(b.y - cy) > c.width / 2 + b.r + 2) continue;
      const cur = fieldToHiveBody(b.x, b.y, b.z, cy, h.upSide);
      const before = fieldToHiveBody(prev.x, prev.y, prev.z, cy, h.upSide);
      const inPent = pointInPolygon(cur.w, cur.b, PENTAGON);
      const inPentShrunk = pointInPolygonInset(cur.w, cur.b, b.r * 0.6);
      if (!h.tipping) {
        // entering the open mouth of the upward CELL
        const crossedMouth = before.a > c.aOut && cur.a <= c.aOut && cur.a > c.aIn;
        const insideCell = cur.a <= c.aOut && cur.a >= c.aIn;
        if ((crossedMouth || insideCell) && inPentShrunk) {
          b.state = 'cell'; b.vx = b.vy = b.vz = 0;
          h.upCell.push(b);
          this.log(`${b.kind.toUpperCase()} scored in the ${alliance} HIVE (${this.cellMass(h).toFixed(1)} / ${this.opts.tipMass} POLLEN-equivalents)`);
          this.checkTip(alliance);
          return true;
        }
      }
      // otherwise: does it hit the up CELL shell, or the down CELL (solid)?
      const upShell = cur.a <= c.aOut + b.r && cur.a >= c.aIn - b.r && !inPent && pointInPolygonInset(cur.w, cur.b, -b.r);
      const upBack = cur.a < c.aIn && cur.a > c.aIn - b.r && inPent;
      const downCell = cur.a >= -c.aOut - b.r && cur.a <= -c.aIn + b.r && pointInPolygonInset(cur.w, cur.b, -b.r);
      if (upShell || upBack || downCell) {
        // bounce: reflect velocity roughly away from the HIVE, lose energy
        const away = this.rng() * 0.6 + 0.2;
        const dirx = Math.sign(b.x || 1), diry = Math.sign(b.y - cy || 1);
        const sp = Math.hypot(b.vx, b.vy, b.vz) * 0.3;
        b.vx = dirx * sp * away; b.vy = diry * sp * (1 - away) * 0.6; b.vz = Math.abs(b.vz) * 0.2 + 10;
        b.x = prev.x; b.y = prev.y; b.z = prev.z;
        return false;
      }
    }
    return false;
  }

  cellMass(h) {
    return h.upCell.reduce((m, b) => m + (b.kind === 'nectar' ? NECTAR_POLLEN_EQUIV : 1), 0);
  }

  checkTip(alliance) {
    const h = this.hives[alliance];
    if (!h.tipping && this.cellMass(h) >= this.opts.tipMass) {
      h.tipping = { t: 0, duration: ASSUMPTIONS.tipDurationSeconds, fromSide: h.upSide };
      this.log(`${alliance.toUpperCase()} HIVE is tipping!`);
    }
  }

  stepHives(dt) {
    for (const alliance of ['red', 'blue']) {
      const h = this.hives[alliance];
      if (!h.tipping) continue;
      h.tipping.t += dt;
      if (h.tipping.t >= h.tipping.duration) {
        const oldSide = h.upSide;
        h.upSide = -oldSide;
        h.tips++;
        const dumped = h.upCell;
        h.upCell = [];
        h.tipping = null;
        const cy = HIVE.centerY[alliance];
        for (const b of dumped) {
          b.state = 'floor';
          b.x = oldSide * (20 + this.rng() * 10);
          b.y = cy + (this.rng() - 0.5) * 14;
          b.vx = oldSide * (20 + this.rng() * 40);
          b.vy = (this.rng() - 0.5) * 40;
          b.z = 0; b.vz = 0;
        }
        if (this.nectarUnlocked[alliance] < this.nectarOffField[alliance]) this.nectarUnlocked[alliance]++;
        this.log(`${alliance.toUpperCase()} HIVE TIP #${h.tips} (+${POINTS.hiveTip}). ${dumped.length} elements dumped on the ${oldSide > 0 ? 'audience' : 'rear'} side. One NECTAR unlocked.`);
      }
    }
  }

  updateFlags() {
    const rb = this.robot;
    if (!rb.left) {
      const d = Math.hypot(rb.x - this.startPose.x, rb.y - this.startPose.y);
      if (d > ROBOT_BODY.length) {
        rb.left = true;
        if (this.phase === 'auto') this.log(`LEAVE achieved (+${POINTS.leave})`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  /** Live score summary for the UI. */
  score() {
    const out = {};
    const inFlowerWindow = this.phase === 'practice' || this.phase === 'finished' ||
      (this.phase === 'teleop' && (MATCH.teleopSeconds - this.phaseTime) <= MATCH.flowerScoringWindow);
    for (const alliance of ['red', 'blue']) {
      const h = this.hives[alliance];
      let flowerPoints = 0;
      for (const fl of this.flowers) flowerPoints += scoreFlower(fl.stack.map((b) => ({ kind: b.kind, alliance: b.alliance })))[alliance];
      const g = GARDEN[alliance];
      const gardenElements = this.balls.filter((b) => b.state === 'floor' && rectContains(g, b.x, b.y, b.r) &&
        (b.kind === 'pollen' || b.alliance === alliance)).length;
      const mine = alliance === this.alliance;
      // PARK is judged at the end of each period; before that, show the live state for the period in progress
      const inZone = mine && this.robotInLoadingZone();
      const parkedAuto = this.phase === 'auto' ? inZone : mine && this.robot.parkedAuto;
      const parkedTeleop = this.phase === 'finished' ? mine && this.robot.parkedTeleop : (this.phase === 'auto' ? false : inZone);
      const s = {
        left: mine && this.robot.left,
        parkedAuto,
        parkedTeleop,
        tips: h.tips,
        cellElements: h.upCell.length,
        flowerPoints: inFlowerWindow ? flowerPoints : 0,
        gardenElements,
      };
      out[alliance] = { ...s, ...tallyAlliance(s) };
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  writeSensors() {
    if (!this.views) return;
    const { i32, f64 } = this.views;
    const rb = this.robot;
    f64[F.TIME_S] = this.time;
    f64[F.MATCH_TIME_S] = this.phaseTime;
    f64[F.BATTERY_V] = 12.9 - 0.4 * this.motors.reduce((a, m) => a + m.current, 0) / 10;
    for (let i = 0; i < this.motors.length; i++) {
      const m = this.motors[i];
      f64[F.MOTOR_ENC_BASE + i] = m.encoder;
      f64[F.MOTOR_VEL_BASE + i] = m.velocityTicksPerSec;
      f64[F.MOTOR_CURRENT_BASE + i] = m.current;
    }
    let yaw = rb.heading * DEG - rb.yawOffset;
    while (yaw > 180) yaw -= 360;
    while (yaw < -180) yaw += 360;
    f64[F.IMU_YAW] = yaw;
    f64[F.IMU_PITCH] = 0; f64[F.IMU_ROLL] = 0;
    f64[F.IMU_YAW_RATE] = rb.omega * DEG;
    f64[F.IMU_PITCH_RATE] = 0; f64[F.IMU_ROLL_RATE] = 0;
    f64[F.IMU_ACC_Z] = 9.81;
    f64[F.DISTANCE_IN] = this.distanceSensorReading();
    const colour = this.colorSensorReading();
    f64[F.COLOR_R] = colour.r; f64[F.COLOR_G] = colour.g; f64[F.COLOR_B] = colour.b; f64[F.COLOR_A] = colour.a;
    f64[F.COLOR_DIST_IN] = colour.dist;
    f64[F.TOUCH] = rb.frontContact ? 1 : 0;
    f64[F.MAGAZINE_COUNT] = rb.magazine.length;
    f64[F.LAUNCHER_RPM] = this.motors[5].rpm;
    f64[F.POSE_X] = rb.x; f64[F.POSE_Y] = rb.y; f64[F.POSE_HEADING_DEG] = rb.heading * DEG;
    for (let s = 0; s < this.servos.length; s++) f64[F.SERVO_ACTUAL_BASE + s] = this.servos[s].actual;
    const n = Math.min(this.tags.length, MAX_TAGS);
    for (let t = 0; t < n; t++) {
      const d = this.tags[t];
      const o = F.TAG_BASE + t * TAG_STRIDE;
      f64[o] = d.id; f64[o + 1] = d.isCluster ? 1 : 0; f64[o + 2] = d.x; f64[o + 3] = d.y; f64[o + 4] = d.z;
      f64[o + 5] = d.yaw; f64[o + 6] = d.pitch; f64[o + 7] = d.roll; f64[o + 8] = d.range; f64[o + 9] = d.bearing;
      f64[o + 10] = d.elevation; f64[o + 11] = d.percent;
    }
    i32[I.TAG_COUNT] = n;
    Atomics.add(i32, I.TICK, 1);
    Atomics.notify(i32, I.TICK);
  }

  distanceSensorReading() {
    const spec = findSensor('sensor_distance');
    const rb = this.robot;
    const c = Math.cos(rb.heading), s = Math.sin(rb.heading);
    const ox = rb.x + spec.offset[0] * c - spec.offset[1] * s;
    const oy = rb.y + spec.offset[0] * s + spec.offset[1] * c;
    let best = Infinity;
    for (const ob of this.obstacles) {
      const t = C.rayPolygon(ox, oy, c, s, ob.poly);
      if (t < best) best = t;
    }
    for (const b of this.balls) {
      if (b.state !== 'floor') continue;
      const t = C.rayCircle(ox, oy, c, s, b.x, b.y, b.r);
      if (t < best) best = t;
    }
    if (best > spec.maxRange) return 322.4; // REV 2m sensor reports 8190 mm when nothing is in range
    return best + (this.rng() - 0.5) * 0.2;
  }

  colorSensorReading() {
    const mag = this.robot.magazine;
    if (mag.length === 0) return { r: 0.02, g: 0.02, b: 0.02, a: 0.05, dist: 4.5 };
    const b = mag[mag.length - 1];
    if (b.kind === 'pollen') return { r: 0.85, g: 0.75, b: 0.12, a: 0.9, dist: 0.6 };
    if (b.alliance === 'red') return { r: 0.9, g: 0.12, b: 0.1, a: 0.9, dist: 0.6 };
    return { r: 0.1, g: 0.2, b: 0.9, a: 0.9, dist: 0.6 };
  }
}

/** Point in the CELL pentagon inset by `inset` (positive = smaller polygon). */
function pointInPolygonInset(w, b, inset) {
  const c = HIVE.cell;
  const hw = c.width / 2 - inset;
  const base = c.b0 + inset;
  const top = c.b0 + c.height - inset;
  const shoulder = c.b0 + c.shoulder - inset * 0.3;
  if (hw <= 0 || top <= base) return false;
  const poly = [[-hw, base], [hw, base], [hw, shoulder], [0, top], [-hw, shoulder]];
  return pointInPolygon(w, b, poly);
}
