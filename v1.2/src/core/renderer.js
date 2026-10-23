// src/core/renderer.js — renderer creation + GPU-loss handling + optional debug overlay.
import * as THREE from 'three';

export function createRenderer(parent, { maxPixelRatio = 1.5, onLost = () => {}, onRestored = () => {} } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false });
  const base = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
  let scale = 1;
  const resize = () => { renderer.setPixelRatio(base * scale); renderer.setSize(innerWidth, innerHeight); };
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = false;
  resize(); parent.appendChild(renderer.domElement);
  addEventListener('resize', resize);

  // GPU context loss: stop rendering, keep the page alive. Three.js re-uploads buffers/textures itself when the context returns.
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); console.error('[gfx] WebGL context lost'); onLost(); });
  renderer.domElement.addEventListener('webglcontextrestored', () => { console.info('[gfx] WebGL context restored'); onRestored(); });
  return { renderer, get scale() { return scale; }, setScale(s) { scale = s; resize(); } };
}

/** ?debug overlay: fps, frame ms, draw calls, triangles, GPU object counts. This is how you SEE a stability problem before it crashes. */
export function createDebugOverlay(renderer) {
  const el = document.createElement('pre');
  el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9;margin:0;padding:6px 8px;background:#000a;color:#9f9;font:11px/1.35 monospace;pointer-events:none;white-space:pre';
  document.body.appendChild(el); let frames = 0, acc = 0, shown = 0;
  return (dtMs, extra = '') => { frames++; acc += dtMs; if (acc < 500) return; const i = renderer.info;
    el.textContent = `${(1000 * frames / acc).toFixed(0)} fps  ${(acc / frames).toFixed(1)} ms\ncalls ${i.render.calls}  tris ${i.render.triangles}\ngeom ${i.memory.geometries}  tex ${i.memory.textures}  progs ${i.programs?.length ?? '?'}\n${extra}`;
    frames = 0; acc = 0; shown++; };
}
