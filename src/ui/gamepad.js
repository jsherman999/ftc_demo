// Gamepad and keyboard input -> shared memory (gamepad1 / gamepad2).
//
// Physical gamepads use the browser Gamepad API with the "standard" mapping
// (Logitech F310 in X mode, Xbox, PS4/PS5 all work). Like the real Driver
// Station, a controller is assigned by pressing START + A (gamepad1) or
// START + B (gamepad2). The first controller is also auto-assigned to
// gamepad1 so a single driver can just start driving.
//
// Keyboard fallback (gamepad1 only):
//   W A S D          left stick          arrow keys      right stick
//   Q / E            left / right trigger
//   J K U I          A B X Y             N / M           left / right bumper
//   T F G H          dpad up left down right
//   Enter / Backspace  start / back
import { I, F, BUTTON_BITS } from '../sim/shared-memory.js';

const KEYMAP = {
  KeyW: ['axis', 1, -1], KeyS: ['axis', 1, 1], KeyA: ['axis', 0, -1], KeyD: ['axis', 0, 1],
  ArrowUp: ['axis', 3, -1], ArrowDown: ['axis', 3, 1], ArrowLeft: ['axis', 2, -1], ArrowRight: ['axis', 2, 1],
  KeyQ: ['axis', 4, 1], KeyE: ['axis', 5, 1],
  KeyJ: ['btn', 'a'], KeyK: ['btn', 'b'], KeyU: ['btn', 'x'], KeyI: ['btn', 'y'],
  KeyN: ['btn', 'left_bumper'], KeyM: ['btn', 'right_bumper'],
  KeyT: ['btn', 'dpad_up'], KeyG: ['btn', 'dpad_down'], KeyF: ['btn', 'dpad_left'], KeyH: ['btn', 'dpad_right'],
  Enter: ['btn', 'start'], Backspace: ['btn', 'back'],
};
// standard gamepad button indices
const STD_BUTTONS = ['a', 'b', 'x', 'y', 'left_bumper', 'right_bumper', null, null, 'back', 'start', 'left_stick_button', 'right_stick_button', 'dpad_up', 'dpad_down', 'dpad_left', 'dpad_right', 'guide'];

export class InputManager {
  constructor(views) {
    this.v = views;
    this.keys = new Set();
    this.assigned = { 1: null, 2: null };  // gamepad index per slot
    this.keyboardEnabled = true;
    this.status = { 1: 'keyboard', 2: 'none' };
    this.onChange = null;
    window.addEventListener('keydown', (e) => {
      if (this.isTypingTarget(e.target)) return;
      if (KEYMAP[e.code]) { this.keys.add(e.code); e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepadconnected', () => this.updateStatus());
    window.addEventListener('gamepaddisconnected', (e) => {
      for (const slot of [1, 2]) if (this.assigned[slot] === e.gamepad.index) this.assigned[slot] = null;
      this.updateStatus();
    });
  }

  isTypingTarget(el) {
    return el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.isContentEditable);
  }

  /** Poll once per animation frame. */
  poll() {
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
    // START + A / START + B assignment, like the Driver Station
    for (const p of pads) {
      const start = p.buttons[9] && p.buttons[9].pressed;
      if (start && p.buttons[0] && p.buttons[0].pressed && this.assigned[1] !== p.index) { this.assign(1, p.index); }
      if (start && p.buttons[1] && p.buttons[1].pressed && this.assigned[2] !== p.index) { this.assign(2, p.index); }
    }
    // convenience: auto-assign the first pad to gamepad1
    if (this.assigned[1] === null && pads.length > 0 && !pads.some((p) => p.index === this.assigned[2])) {
      this.assign(1, pads[0].index);
    }
    for (const slot of [1, 2]) {
      const pad = pads.find((p) => p.index === this.assigned[slot]);
      let axes = [0, 0, 0, 0, 0, 0];
      let bits = 0;
      if (pad) {
        const dz = (x) => (Math.abs(x) < 0.06 ? 0 : x);
        axes = [dz(pad.axes[0] || 0), dz(pad.axes[1] || 0), dz(pad.axes[2] || 0), dz(pad.axes[3] || 0),
          pad.buttons[6] ? pad.buttons[6].value : 0, pad.buttons[7] ? pad.buttons[7].value : 0];
        STD_BUTTONS.forEach((name, i) => { if (name && pad.buttons[i] && pad.buttons[i].pressed) bits |= BUTTON_BITS[name]; });
        // some pads report the dpad as axis 9 (non-standard); ignore
        this.rumble(pad, slot);
      }
      if (slot === 1 && this.keyboardEnabled) {
        for (const code of this.keys) {
          const m = KEYMAP[code];
          if (!m) continue;
          if (m[0] === 'axis') axes[m[1]] = Math.max(-1, Math.min(1, axes[m[1]] + m[2]));
          else bits |= BUTTON_BITS[m[1]];
        }
      }
      const base = slot === 1 ? F.GP1_AXES : F.GP2_AXES;
      for (let i = 0; i < 6; i++) this.v.f64[base + i] = axes[i];
      Atomics.store(this.v.i32, slot === 1 ? I.GAMEPAD1_BUTTONS : I.GAMEPAD2_BUTTONS, bits);
    }
  }

  rumble(pad, slot) {
    const idx = slot === 1 ? I.RUMBLE1 : I.RUMBLE2;
    const ms = Atomics.exchange(this.v.i32, idx, 0);
    if (ms > 0 && pad.vibrationActuator && pad.vibrationActuator.playEffect) {
      pad.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: 0.8, weakMagnitude: 0.5 }).catch(() => {});
    }
  }

  assign(slot, index) {
    for (const s of [1, 2]) if (this.assigned[s] === index) this.assigned[s] = null;
    this.assigned[slot] = index;
    this.updateStatus();
  }

  updateStatus() {
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
    for (const slot of [1, 2]) {
      const pad = pads.find((p) => p.index === this.assigned[slot]);
      this.status[slot] = pad ? pad.id.replace(/\(.*$/, '').trim().slice(0, 28) : (slot === 1 ? 'keyboard' : 'none');
    }
    if (this.onChange) this.onChange(this.status);
  }

  /** Current gamepad1 state for the on-screen indicator. */
  snapshot(slot = 1) {
    const base = slot === 1 ? F.GP1_AXES : F.GP2_AXES;
    const bits = Atomics.load(this.v.i32, slot === 1 ? I.GAMEPAD1_BUTTONS : I.GAMEPAD2_BUTTONS);
    const btns = Object.keys(BUTTON_BITS).filter((n) => bits & BUTTON_BITS[n]);
    return { axes: Array.from({ length: 6 }, (_, i) => this.v.f64[base + i]), buttons: btns };
  }
}
