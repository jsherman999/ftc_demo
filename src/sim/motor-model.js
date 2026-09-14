// DC motor + encoder model with the four FTC run modes.
//
// A brushed DC motor at a given supply fraction (power) has a linear
// torque-speed curve: torque = stall * (power - omega / omegaFree). The load
// (wheel + robot inertia) is folded into a first-order response so a motor
// reaches ~63 % of its target speed in `tau` seconds. That is enough to feel
// like a real goBILDA motor: it spins up over a fraction of a second and a
// step in power does not produce an instantaneous step in velocity.
import { MOTOR_TYPES } from './robot-config.js';
import { RunMode } from './shared-memory.js';

export class MotorModel {
  constructor(spec, opts = {}) {
    this.spec = spec;
    this.type = MOTOR_TYPES[spec.type];
    this.ticksPerRev = this.type.ticksPerRev;
    this.freeRadPerSec = this.type.freeRpm * 2 * Math.PI / 60;
    this.tau = opts.tau ?? 0.12;          // seconds to 63 % of target speed
    this.reversed = false;
    this.mode = RunMode.RUN_WITHOUT_ENCODER;
    this.brake = false;
    this.power = 0;                       // commanded power -1..1
    this.velocitySetpoint = null;         // ticks/s when setVelocity used
    this.targetPosition = 0;
    this.omega = 0;                       // output shaft rad/s (signed, motor frame)
    this.positionRad = 0;                 // accumulated rotation
    this.encoderOffset = 0;               // subtracted on STOP_AND_RESET_ENCODER
    this.current = 0;
    this.loadFactor = 1;                  // 0..1 external speed limit (wheel blocked)
    this.pidTolerance = 10;               // ticks
  }

  /** Encoder ticks as the SDK reports them (direction-aware, reset-aware). */
  get encoder() {
    const raw = this.positionRad / (2 * Math.PI) * this.ticksPerRev;
    const ticks = Math.round(raw - this.encoderOffset);
    return (this.reversed ? -ticks : ticks) + 0;   // + 0 turns -0 into 0
  }

  get velocityTicksPerSec() {
    const v = this.omega / (2 * Math.PI) * this.ticksPerRev;
    return this.reversed ? -v : v;
  }

  isBusy() {
    if (this.mode !== RunMode.RUN_TO_POSITION) return false;
    return Math.abs(this.targetPosition - this.encoder) > this.pidTolerance;
  }

  resetEncoder() {
    this.encoderOffset = this.positionRad / (2 * Math.PI) * this.ticksPerRev;
  }

  /**
   * Effective drive fraction (-1..1) after the run-mode logic.
   *   RUN_WITHOUT_ENCODER: open loop power
   *   RUN_USING_ENCODER: power is a velocity fraction; a P controller holds it
   *   RUN_TO_POSITION: proportional approach to target, magnitude limited by |power|
   *   STOP_AND_RESET_ENCODER: motor off
   */
  drive() {
    const sign = this.reversed ? -1 : 1;
    switch (this.mode) {
      case RunMode.STOP_AND_RESET_ENCODER:
        return 0;
      case RunMode.RUN_TO_POSITION: {
        const err = this.targetPosition - this.encoder;          // ticks, SDK frame
        const kP = 0.004;                                        // per tick
        const cmd = Math.max(-1, Math.min(1, err * kP));
        const limit = Math.abs(this.power);
        return sign * Math.max(-limit, Math.min(limit, cmd));
      }
      case RunMode.RUN_USING_ENCODER: {
        // velocity control: target = power * free speed (or explicit setpoint)
        let targetTps;
        if (this.velocitySetpoint !== null) targetTps = this.velocitySetpoint;
        else targetTps = this.power * this.type.freeRpm / 60 * this.ticksPerRev;
        const maxTps = this.type.freeRpm / 60 * this.ticksPerRev;
        const err = (targetTps - this.velocityTicksPerSec) / maxTps;
        const ff = targetTps / maxTps;
        return sign * Math.max(-1, Math.min(1, ff + err * 1.5));
      }
      default:
        return sign * this.power;
    }
  }

  /** Advance the shaft. loadFactor < 1 means the shaft is fighting a load (wheel slip). */
  step(dt) {
    const d = this.drive();
    const target = d * this.freeRadPerSec * this.loadFactor;
    // first-order approach; braking (zero power with BRAKE) decays faster
    let tau = this.tau;
    if (d === 0 && this.brake) tau = this.tau * 0.35;
    if (d === 0 && !this.brake) tau = this.tau * 2.5;   // coasting
    const alpha = 1 - Math.exp(-dt / tau);
    this.omega += (target - this.omega) * alpha;
    if (Math.abs(this.omega) < 1e-4) this.omega = 0;
    this.positionRad += this.omega * dt;
    // rough current estimate: proportional to torque demand
    const torqueFrac = Math.abs(d - this.omega / this.freeRadPerSec);
    this.current = 0.25 + torqueFrac * 9.2 * Math.abs(d);
  }

  /** Output shaft rpm (unsigned). */
  get rpm() { return Math.abs(this.omega) * 60 / (2 * Math.PI); }
}
