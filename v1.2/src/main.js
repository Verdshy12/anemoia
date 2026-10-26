
/* src/main.js — composition root.
 *   Creates systems, wires them, owns nothing else. */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CONFIG as C } from './config.js';
import { createLoop } from './core/loop.js';
import { createRenderer, createDebugOverlay } from './core/renderer.js';
import { QualityScaler } from './core/quality.js';
import { createInput } from './core/input.js';
import {
  createVehicle, stepVehicle, applyImpact, CAR
} from './car/vehicle.js';
import { rigCar } from './car/carRig.js';
import { StaticWorld, collideCar } from './world/staticWorld.js';
import { buildRoadMesh, buildBuildingMesh } from './world/meshes.js';
import {
  startAudio, updateAudio, toggleRadio, changeTrack
} from './audio/audio.js';

const $ = (id) => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const damp = THREE.MathUtils.damp;

const text = (() => {
  const cache = {};

  return (id, value) => {
    if (cache[id] !== value) {
      cache[id] = value;
      const element = $(id);
      if (element) element.textContent = value;
    }
  };
})();

const debug = new URLSearchParams(location.search).has('debug');

const game = {
  ready: false,
  started: false,
  error: null,
  sim: null,
  world: null,
  stats: {}
};

let startRequested = false;
window.__game = game;

// ---------- Session lifecycle ----------
let loop = null;

function beginSession() {
  if (!startRequested || !game.ready || !loop || game.started) return;
  game.started = true;

  // Remove stale inputs before the driving session begins.
  input.clear?.();

  // Start the existing fixed-step simulation loop.

  window.focus();
  document.body.focus?.();

  loop.start();

  requestAnimationFrame(() => {
    window.focus();
  });

  // The loading screen should not cover the game.
  const loading = $('loading');
  if (loading) {
    loading.style.opacity = '0';

    setTimeout(() => {
      loading.style.display = 'none';
    }, 450);
  }

  text(
    'message',
    'Welcome to HOOD · Press ↑ to accelerate · C for camera'
  );

  // Let index.html dismiss the splash only after the loop starts.
  window.dispatchEvent(new Event('hood:session-started'));
}

function requestSessionStart() {
  startRequested = true;
  window.__HOOD_START_REQUESTED = true;

  // If loading has finished, start immediately.
  // Otherwise boot() will start the session when ready.
  beginSession();
}

window.addEventListener('hood:start-requested', requestSessionStart);

// ---------- Renderer / scene ----------
const gfx = createRenderer($('game'), {
  maxPixelRatio: C.gfx.maxPixelRatio,

  onLost: () => {
    loop?.stop();
    text(
      'message',
      'Graphics context lost — waiting for the GPU to recover…'
    );
  },

  onRestored: () => {
    // Do not start driving automatically after GPU recovery.
    if (game.started) loop?.start();
  }
});

const { renderer } = gfx;
const scaler = new QualityScaler({
  min: C.gfx.minScale,
  targetFps: C.gfx.targetFps
});

const scene = new THREE.Scene();
scene.background = new THREE.Color(C.gfx.sky);
scene.fog = new THREE.Fog(C.gfx.sky, C.gfx.fogNear, C.gfx.fogFar);

scene.add(new THREE.HemisphereLight(0xd9edff, 0x424034, 2));

const sun = new THREE.DirectionalLight(0xffe0b5, 2.5);
sun.position.set(-30, 50, 20);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(6000, 6000),
                              new THREE.MeshStandardMaterial({
                                color: 0x52634a,
                                roughness: 1
                              })
);

ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
scene.add(ground);

const camera = new THREE.PerspectiveCamera(
  75,
  innerWidth / innerHeight,
  0.1,
  600
);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

const rig = new THREE.Group();
scene.add(rig);

const overlay = debug ? createDebugOverlay(renderer) : null;

// ---------- Input ----------
let cameraMode = 'chase';

const input = createInput({
  onKey: (k) => {
    // Ignore gameplay shortcuts before the player enters.
    if (!game.started) return;

    startAudio();

    if (k === 'c') toggleCamera();
    if (k === 'r') toggleRadio();
    if (k === '[') changeTrack(-1);
    if (k === ']') changeTrack(1);
  }
});

// Audio can be unlocked by a deliberate interaction with the
// game page. The splash is inside an iframe, so its clicks do
// not bubble into this document.
addEventListener('pointerdown', () => {
  if (game.started) startAudio();
});

$('camBtn')?.addEventListener('click', () => {
  if (game.started) toggleCamera();
});

$('playBtn')?.addEventListener('click', () => {
  if (game.started) toggleRadio();
});

$('prevBtn')?.addEventListener('click', () => {
  if (game.started) changeTrack(-1);
});

$('nextBtn')?.addEventListener('click', () => {
  if (game.started) changeTrack(1);
});

function toggleCamera() {
  cameraMode = cameraMode === 'chase' ? 'cockpit' : 'chase';

  text(
    'viewSubtitle',
    cameraMode === 'chase'
    ? 'CHASE CAMERA · PRESS C FOR COCKPIT'
    : 'FIRST-PERSON · PRESS C FOR CHASE CAMERA'
  );
}

// ---------- Boot ----------
async function boot() {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);

  const [tile, gltf] = await Promise.all([
    fetch(C.map.tile).then((response) => {
      if (!response.ok) {
        throw new Error('tile HTTP ' + response.status);
      }

      return response.json();
    }),

    loader.loadAsync(C.car.model)
  ]);

  const world = new StaticWorld(tile);
  game.world = world;

  scene.add(
    buildRoadMesh(tile.roads),
            buildBuildingMesh(tile.buildings)
  );

  const car = rigCar(gltf.scene, {
    targetLength: C.car.targetLength,
    headingOffset: C.car.headingOffset
  });

  rig.add(car.root);

  const s = createVehicle(
    tile.spawn.x,
    tile.spawn.z,
    tile.spawn.psi
  );

  game.sim = s;

  let impactShake = 0;
  let lastImpact = 0;
  let controls = input.poll(0);
  let surface = world.surfaceAt(s.x, s.z);

  const step = (dt) => {
    surface = world.surfaceAt(s.x, s.z);

    stepVehicle(s, controls, surface, dt);

    const hit = collideCar(world, s, applyImpact);

    if (hit > 1) {
      lastImpact = hit;
      impactShake = Math.min(1, hit / 15);
    }
  };

  const cam = {
    pos: new THREE.Vector3(),
    look: new THREE.Vector3(),
    init: false
  };

  const v3 = new THREE.Vector3();

  const render = (alpha, dtSec) => {
    controls = input.poll(dtSec);

    rig.position.set(s.x, 0, s.z);
    rig.rotation.y = -s.psi;

    car.update(s.wheelAngle, s.wheelSpin);

    car.root.rotation.x = damp(
      car.root.rotation.x,
      clamp(s.aLong * 0.0042, -0.05, 0.04),
                               5,
                               dtSec
    );

    car.root.rotation.z = damp(
      car.root.rotation.z,
      clamp(-s.aLat * 0.0032, -0.07, 0.07),
                               4,
                               dtSec
    );

    impactShake = damp(impactShake, 0, 4, dtSec);

    const sh = impactShake * 0.15 *
    Math.sin(performance.now() * 0.08);

    const want = v3.set(
      ...(cameraMode === 'chase' ? C.car.chase : C.car.cockpit)
    );

    rig.localToWorld(want);

    if (!cam.init || cameraMode === 'cockpit') {
      cam.pos.copy(want);
      cam.init = true;
    } else {
      cam.pos.lerp(want, 1 - Math.exp(-6 * dtSec));
    }

    camera.position.copy(cam.pos);
    camera.position.y += sh;

    camera.lookAt(
      rig.localToWorld(
        v3.set(
          ...(cameraMode === 'chase'
          ? C.car.chaseLook
          : [
            C.car.cockpit[0],
            C.car.cockpit[1],
            -20
          ])
        )
      )
    );

    camera.fov = damp(
      camera.fov,
      72 + s.speed * 0.14 + (s.boosting ? 8 : 0),
                      4,
                      dtSec
    );

    camera.updateProjectionMatrix();

    text(
      'speed',
      String(Math.round(s.speed * 3.6)).padStart(3, '0')
    );

    text(
      'rpmText',
      Math.round(s.rpm / 10) * 10 + ' RPM'
    );

    $('rpmFill').style.width =
    (s.rpm / CAR.redline) * 100 + '%';

    text(
      'gear',
      s.reverse
      ? 'R'
      : s.speed < 0.5 && s.throttle < 0.05
      ? 'N'
      : 'D' + (s.gear + 1)
    );

    text(
      'steering',
      `STEERING: ${Math.round(controls.steer * 30)}°`
    );

    $('boostFill').style.width = s.nitro * 100 + '%';

    text(
      'boostPercent',
      Math.round(s.nitro * 100) + '%'
    );

    text(
      'message',
      !surface.onRoad
      ? 'Off road — grip reduced'
      : s.drifting
      ? 'Drifting — counter-steer!'
      : lastImpact > 6 && impactShake > 0.2
      ? 'Crash!'
      : 'Driving · C camera · R radio'
    );

    updateAudio(s.rpm, s.throttle);

    renderer.render(scene, camera);

    const ns = scaler.sample(dtSec * 1000);
    if (ns) gfx.setScale(ns);

    overlay?.(
      dtSec * 1000,
      `speed ${(s.speed * 3.6).toFixed(0)} km/h  gear ${s.gear + 1}\n` +
      `scale ${gfx.scale}  surf ${surface.onRoad ? 'road' : 'grass'}`
    );

    game.stats = {
      calls: renderer.info.render.calls,
      tris: renderer.info.render.triangles,
      geoms: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      scale: gfx.scale,
      wheelsOk: car.ok,
      lastImpact
    };
  };


  // Create the loop, but keep the driving simulation paused.
  loop = createLoop({
    step,
    render,
    fixedDt: C.sim.fixedDt,
    maxSubSteps: C.sim.maxSubSteps
  });

  game.loop = loop;

  // Prepare the scene's GPU programs before announcing readiness.
  // If preparation fails, boot() catches the error below.
  await renderer.compileAsync(scene, camera);

  // Render one initial frame to initialize and verify the scene.
  // This does NOT start the driving loop.
  render(0, C.sim.fixedDt);

  // Hide the loading indicator only after successful preparation.
  const loading = $('loading');

  if (loading) {
    loading.style.opacity = '0';

    setTimeout(() => {
      loading.style.display = 'none';
    }, 450);
  }

  // The world, car, systems, loop and initial render are ready.
  game.ready = true;

  console.log('[HOOD] Fully prepared. Waiting for player.');

  // Tell index.html that the complete scene is ready.
  window.dispatchEvent(new Event('hood:game-ready'));

  // Honour a start request if one arrived during preparation.
  beginSession();
}

boot().catch((e) => {
  game.error = String(e);

  console.error('[HOOD] Boot failed:', e);

  text('message', 'Failed to start: ' + e.message);

  const loading = $('loading');
  if (loading) {
    loading.textContent = 'FAILED TO LOAD — see console';
    loading.style.opacity = '1';
    loading.style.display = 'block';
  }

  window.dispatchEvent(
    new CustomEvent('hood:boot-error', {
      detail: { message: e.message || String(e) }
    })
  );
});

  text('message', 'Ready when you are · Enter to start driving');

  // Honor a start request that arrived while assets were loading.
  if (startRequested || window.__HOOD_START_REQUESTED === true) {
    requestSessionStart();
  }
