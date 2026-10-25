// src/core/input.js — keyboard + touch buttons + gamepad  ->  one `controls` object. Vehicle code never sees raw devices.
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
/** Digital steering feels bad if it snaps. Ramp toward the target; return to centre faster than you turn. */
export function smoothSteer(current, target, dt) {
  const rate = target === 0 ? 7 : 3.2;                                           // units/s
  const d = target - current, m = rate * dt;
  return Math.abs(d) <= m ? target : current + Math.sign(d) * m;
}

export function createInput({ onKey = () => {}, buttons = {} } = {}) {
  const keys = new Set(), ui = { turbo: false, drift: false, throttle: false, brake: false, left: false, right: false }, state = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
  let tiltSteer = 0, tiltBaseline = null, tiltActive = false, orientationListening = false;
  const down = (...k) => k.some((x) => keys.has(x));
  const normaliseAngle = (degrees) => ((degrees + 540) % 360) - 180;
  const readTilt = (event) => {
    const angle = ((screen.orientation?.angle ?? window.orientation ?? 0) + 360) % 360;
    if (angle === 90) return event.beta;
    if (angle === 270) return -event.beta;
    if (angle === 180) return -event.gamma;
    return event.gamma;
  };
  const onOrientation = (event) => {
    const value = readTilt(event);
    if (!Number.isFinite(value)) return;
    if (tiltBaseline == null) { tiltBaseline = value; return; }
    tiltSteer = clamp(normaliseAngle(value - tiltBaseline) / 24, -1, 1);
  };
  const enableTiltSteering = async () => {
    const Orientation = window.DeviceOrientationEvent;
    if (!Orientation) {
      document.body.classList.add('tilt-unavailable');
      return false;
    }
    try {
      if (typeof Orientation.requestPermission === 'function' && await Orientation.requestPermission() !== 'granted') {
        document.body.classList.add('tilt-unavailable');
        return false;
      }
    } catch {
      document.body.classList.add('tilt-unavailable');
      return false;
    }
    if (!orientationListening) {
      addEventListener('deviceorientation', onOrientation);
      orientationListening = true;
    }
    tiltBaseline = null;
    tiltSteer = 0;
    tiltActive = true;
    document.body.classList.remove('tilt-unavailable');
    document.body.classList.add('tilt-ready');
    return true;
  };
  addEventListener('keydown', (e) => { const k = e.key.toLowerCase(); if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault(); if (!e.repeat) onKey(k); keys.add(k); });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  const releaseAll = () => {
    keys.clear();
    for (const flag of Object.keys(ui)) ui[flag] = false;
    document.querySelectorAll('.drive-hold.on').forEach((el) => el.classList.remove('on'));
  };
  addEventListener('blur', releaseAll);
  for (const [id, flag] of [['turboBtn', 'turbo'], ['driftBtn', 'drift'], ['throttleBtn', 'throttle'], ['brakeBtn', 'brake'], ['steerLeftBtn', 'left'], ['steerRightBtn', 'right']]) {
    const el = document.getElementById(id); if (!el) continue;
    el.classList.add('drive-hold');
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); ui[flag] = true; el.classList.add('on'); el.setPointerCapture(e.pointerId); });
    const release = () => { ui[flag] = false; el.classList.remove('on'); };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, release);
  }
  return {
    /** Forget every held key/button (called when the driving session starts). */
    clear() {
      keys.clear();
      for (const flag of Object.keys(ui)) ui[flag] = false;
      Object.assign(state, { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false });
    },
    /** call once per frame (not per physics step). Returns the shared controls object. */
    poll(dt) {
      const pad = (navigator.getGamepads?.() ?? []).find((p) => p?.connected);
      const digitalSteer = (down('arrowright', 'd') || ui.right ? 1 : 0) - (down('arrowleft', 'a') || ui.left ? 1 : 0);
      let steerT = tiltActive ? tiltSteer : digitalSteer;
      let gas = down('arrowup', 'w') || ui.throttle ? 1 : 0, brk = down('arrowdown', 's') || ui.brake ? 1 : 0, hand = down(' ') || ui.drift, nitro = down('shift', 'n') || ui.turbo;
      state.steer = smoothSteer(state.steer, steerT, dt);
      if (pad) {                                                                  // analog overrides keyboard when used
        const ax = Math.abs(pad.axes[0]) > 0.12 ? pad.axes[0] : 0; if (ax) state.steer = lerp(state.steer, ax, 0.5);
        gas = Math.max(gas, pad.buttons[7]?.value ?? 0); brk = Math.max(brk, pad.buttons[6]?.value ?? 0);
        hand ||= !!pad.buttons[0]?.pressed; nitro ||= !!pad.buttons[5]?.pressed;
      }
      Object.assign(state, { throttle: gas, brake: brk, handbrake: hand, nitro });
      return state;
    },
    enableTiltSteering,
  };
}
