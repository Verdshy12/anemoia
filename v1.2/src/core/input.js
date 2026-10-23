// src/core/input.js — keyboard + touch buttons + gamepad  ->  one `controls` object. Vehicle code never sees raw devices.
const lerp = (a, b, t) => a + (b - a) * t;
/** Digital steering feels bad if it snaps. Ramp toward the target; return to centre faster than you turn. */
export function smoothSteer(current, target, dt) {
  const rate = target === 0 ? 7 : 3.2;                                           // units/s
  const d = target - current, m = rate * dt;
  return Math.abs(d) <= m ? target : current + Math.sign(d) * m;
}

export function createInput({ onKey = () => {}, buttons = {} } = {}) {
  const keys = new Set(), ui = { turbo: false, drift: false }, state = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
  const down = (...k) => k.some((x) => keys.has(x));
  addEventListener('keydown', (e) => { const k = e.key.toLowerCase(); if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault(); if (!e.repeat) onKey(k); keys.add(k); });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => { keys.clear(); ui.turbo = ui.drift = false; });
  for (const [id, flag] of [['turboBtn', 'turbo'], ['driftBtn', 'drift']]) {                  // on-screen hold buttons (mobile)
    const el = document.getElementById(id); if (!el) continue;
    el.addEventListener('pointerdown', (e) => { ui[flag] = true; el.classList.add('on'); el.setPointerCapture(e.pointerId); });
    for (const ev of ['pointerup', 'pointercancel']) el.addEventListener(ev, () => { ui[flag] = false; el.classList.remove('on'); });
  }
  return {
    /** call once per frame (not per physics step). Returns the shared controls object. */
    poll(dt) {
      const pad = (navigator.getGamepads?.() ?? []).find((p) => p?.connected);
      let steerT = (down('arrowright', 'd') ? 1 : 0) - (down('arrowleft', 'a') ? 1 : 0);
      let gas = down('arrowup', 'w') ? 1 : 0, brk = down('arrowdown', 's') ? 1 : 0, hand = down(' ') || ui.drift, nitro = down('shift', 'n') || ui.turbo;
      state.steer = smoothSteer(state.steer, steerT, dt);
      if (pad) {                                                                  // analog overrides keyboard when used
        const ax = Math.abs(pad.axes[0]) > 0.12 ? pad.axes[0] : 0; if (ax) state.steer = lerp(state.steer, ax, 0.5);
        gas = Math.max(gas, pad.buttons[7]?.value ?? 0); brk = Math.max(brk, pad.buttons[6]?.value ?? 0);
        hand ||= !!pad.buttons[0]?.pressed; nitro ||= !!pad.buttons[5]?.pressed;
      }
      Object.assign(state, { throttle: gas, brake: brk, handbrake: hand, nitro });
      return state;
    },
  };
}
