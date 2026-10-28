// src/car/carRig.js — scale/orient the model and give each wheel a steer+spin pivot at its true centre.
import * as THREE from 'three';

// Works with BOTH the optimized glb ("Wheel_FL"...) and the original export ("3DWheel Front L_39_61").
const WHEEL_NAMES = {
  FL: /^(Wheel_FL|3DWheel Front L)/i, FR: /^(Wheel_FR|3DWheel Front R)/i,
  RL: /^(Wheel_RL|3DWheel Rear L)/i,  RR: /^(Wheel_RR|3DWheel Rear R)/i,
};

export function rigCar(modelScene, { targetLength = 5.02, headingOffset = Math.PI } = {}) {
  const root = new THREE.Group(); root.name = 'carRoot';       // add this to your player rig
  root.add(modelScene);

  // 1) scale to real-world length, face -Z, centre on the origin, sit on y=0
  const raw = new THREE.Box3().setFromObject(modelScene).getSize(new THREE.Vector3());
  modelScene.scale.setScalar(targetLength / Math.max(raw.x, raw.y, raw.z));
  modelScene.rotation.y = headingOffset; modelScene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(modelScene), ctr = box.getCenter(new THREE.Vector3());
  modelScene.position.set(-ctr.x, -box.min.y, -ctr.z); root.updateMatrixWorld(true);

  // 2) find wheels by EXACT name pattern (v1 used substring matching: "rr" matched "challengeRRt" -> 1,240 meshes spun)
  const found = {};
  modelScene.traverse((o) => { for (const [k, re] of Object.entries(WHEEL_NAMES)) if (!found[k] && re.test(o.name)) found[k] = o; });
  const missing = Object.keys(WHEEL_NAMES).filter((k) => !found[k]);
  if (missing.length) console.warn('[carRig] wheels not found:', missing.join(','), '— car will drive without wheel animation');

  // 3) pivot chain per wheel: steer (Y) -> spin (X). Pivot sits at the wheel's world bounding-box centre, so it rotates about its axle.
  const wheels = {};
  for (const [k, node] of Object.entries(found)) {
    const centre = new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3());
    const steer = new THREE.Group(), spin = new THREE.Group();
    steer.name = 'steer_' + k; spin.name = 'spin_' + k;
    root.add(steer); steer.add(spin); steer.position.copy(root.worldToLocal(centre));
    root.updateMatrixWorld(true);
    spin.attach(node);                                          // attach() keeps the world transform
    wheels[k] = { steer, spin, centre: steer.position.clone() };
  }

  // 4) materials: kill any leftover transmission (costly render pass) on un-optimized models
  modelScene.traverse((o) => { if (!o.isMesh) return; o.castShadow = o.receiveShadow = false;
    for (const m of [].concat(o.material)) if (m?.isMeshPhysicalMaterial && m.transmission > 0) { m.transmission = 0; m.needsUpdate = true; } });

  return {
    root, wheels, ok: missing.length === 0,
    /** call every frame with vehicle outputs: steerAngle (rad, + = right turn), spinAngle (rad, accumulated) */
    update(steerAngle, spinAngle) {
      for (const k of ['FL', 'FR']) if (wheels[k]) wheels[k].steer.rotation.y = -steerAngle;   // +y rotation turns left, so negate
      for (const w of Object.values(wheels)) w.spin.rotation.x = spinAngle;                      // axle = X (car's lateral axis)
    },
  };
}
