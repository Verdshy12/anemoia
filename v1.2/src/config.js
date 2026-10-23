// src/config.js — every tunable in one place. Change numbers here, not inside logic.
export const CONFIG = {
  car:  { model: './models/dodge.glb', targetLength: 5.02, headingOffset: Math.PI,
          cockpit: [-0.42, 1.18, 0.15], chase: [0, 2.6, 7.2], chaseLook: [0, 1.0, -4.0] },
  map:  { tile: './data/tiles/state-house.json' },
  sim:  { fixedDt: 1 / 120, maxSubSteps: 6 },
  gfx:  { maxPixelRatio: 1.5, minScale: 0.6, targetFps: 45, fogNear: 90, fogFar: 380, sky: 0x91b9d1 },
};
