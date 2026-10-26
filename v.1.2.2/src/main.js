/* src/main.js — composition root.
 *   Creates systems, wires them, owns nothing else. */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CONFIG as C } from './config.js';
import { createLoop } from './core/loop.js';
import { createRenderer, createDebugOverlay } from './core/renderer.js?v=1.2.5';
import { QualityScaler } from './core/quality.js';
import { createInput } from './core/input.js';
import {
  createVehicle, stepVehicle, applyImpact, CAR
} from './car/vehicle.js';
import { rigCar } from './car/carRig.js';
import { StaticWorld, collideCar } from './world/staticWorld.js';
import { buildRoadMesh, buildBuildingMesh, buildRouteMarkings } from './world/meshes.js';
import { buildRoute, trackProgress } from './world/routes.js';
import { preloadMusic } from '../music/preload.js';
import { rigSteeringWheel, flashMesh, scanNearby, previewSplit } from './car/steeringWheel.js';
import { createCarLights } from './car/carLights.js';

const $ = (id) => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const damp = THREE.MathUtils.damp;
const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// Only touches the DOM when the value actually changes.
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

// Fail early, with a readable message, if config.js is missing something we need.
(function checkConfig() {
  const required = [
    'car.model', 'car.targetLength', 'car.headingOffset', 'car.chase', 'car.chaseLook', 'car.cockpit',
    'routes.file', 'map.tile',
    'gfx.maxPixelRatio', 'gfx.minScale', 'gfx.targetFps', 'gfx.sky', 'gfx.fogNear', 'gfx.fogFar',
    'sim.fixedDt', 'sim.maxSubSteps'
  ];
  const missing = required.filter((path) =>
    path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), C) === undefined);
  if (missing.length) {
    const msg = 'config.js is missing: ' + missing.join(', ');
    console.error('[HOOD] ' + msg);
    throw new Error(msg);
  }
})();

const game = {
  ready: false,
  routeReady: false,
  routeLoading: false,
  started: false,
  error: null,
  sim: null,
  world: null,
  stats: {}
};

window.__game = game;

let startRequested = false;
let loop = null;
let engine = null;
let camSet = [];
let camIndex = 0;
let nextViewGestureAt = 0;
let cockpitFov = 75;
let cockpitOffset = 0;
let cockpitOffsetY = 0;
let cockpitPointerX = null;
let cockpitPointerY = null;
const touchPoints = new Map();
let pinchDistance = 0;
let headlightsOn = false;
let lightsMsgUntil = 0;

// ---------- Session lifecycle ----------
function beginSession() {
  if (!startRequested || game.started) return;

  const blockers = {
    gameReady: game.ready,
    routeReady: game.routeReady,
    loopExists: !!loop
  };

  if (!game.ready || !game.routeReady || !loop) {
    console.warn('[HOOD] Cannot begin session yet:', blockers);
    return;
  }

  console.log('[HOOD] Starting driving session');
  game.started = true;
  if (game.race && !game.race.startedAt) game.race.startedAt = performance.now();

  // Remove stale inputs before the driving session begins.
  input.clear?.();

  window.focus();
  document.body.focus?.();
  loop.start();
  requestAnimationFrame(() => window.focus());

  // The loading screen should not cover the game.
  const loading = $('loading');
  if (loading) {
    loading.style.opacity = '0';
    setTimeout(() => { loading.style.display = 'none'; }, 450);
  }

  text('message', 'Welcome to HOOD · Press ↑ to accelerate · C for camera');

  // index.html dismisses the splash once the loop has started.
  window.dispatchEvent(new Event('hood:session-started'));
}

function requestSessionStart() {
  startRequested = true;
  window.__HOOD_START_REQUESTED = true;
  console.log('[HOOD] Start requested');
  // Starts now if everything is ready; otherwise loadRoute() starts it when done.
  beginSession();
}

window.addEventListener('hood:start-requested', requestSessionStart);

// ---------- Renderer / scene ----------
const gfx = createRenderer($('game'), {
  maxPixelRatio: C.gfx.maxPixelRatio,

  onLost: () => {
    loop?.stop();
    text('message', 'Graphics context lost — waiting for the GPU to recover…');
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
  new THREE.MeshStandardMaterial({ color: 0x52634a, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
scene.add(ground);

const gameViewport = () => ({
  width: $('app-shell')?.clientWidth || innerWidth,
  height: $('app-shell')?.clientHeight || innerHeight
});
const initialViewport = gameViewport();
const camera = new THREE.PerspectiveCamera(75, initialViewport.width / initialViewport.height, 0.1, 600);

addEventListener('resize', () => {
  const viewport = gameViewport();
  camera.aspect = viewport.width / viewport.height;
  camera.updateProjectionMatrix();
});

const rig = new THREE.Group();
scene.add(rig);

const overlay = debug ? createDebugOverlay(renderer) : null;

// ---------- Input ----------
const input = createInput({
  onKey: (k) => {
    // Ignore gameplay shortcuts before the player enters.
    if (!game.started) return;

    if (k === 'c') toggleCamera();
    if (k === 'm') changeRoute();
  }
});

$('routesBtn')?.addEventListener('click', () => { if (game.started) changeRoute(); });
$('camBtn')?.addEventListener('click', () => { if (game.started) selectCockpitView(); });
$('game')?.addEventListener('pointerdown', (event) => {
  cockpitPointerX = event.clientX;
  cockpitPointerY = event.clientY;
  if (event.pointerType === 'touch') {
    touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchPoints.size === 2) pinchDistance = touchDistance();
  }
});
$('game')?.addEventListener('pointermove', (event) => {
  const isTouch = touchPoints.has(event.pointerId);
  if (isTouch) touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (!game.started || camSet[camIndex]?.id !== 'cockpit') return;
  if (isTouch && touchPoints.size === 2) {
    const distance = touchDistance();
    if (pinchDistance) cockpitFov = clamp(cockpitFov + (distance - pinchDistance) * 0.12, 55, 100);
    pinchDistance = distance;
  } else if (isTouch && touchPoints.size === 1 || event.pointerType === 'mouse' && event.buttons === 1) {
    if (cockpitPointerX != null) cockpitOffset = clamp(cockpitOffset + (event.clientX - cockpitPointerX) * 0.003, 0, 0.84);
    if (cockpitPointerY != null) cockpitOffsetY = clamp(cockpitOffsetY - (event.clientY - cockpitPointerY) * 0.002, -0.18, 0.28);
  }
  cockpitPointerX = event.clientX;
  cockpitPointerY = event.clientY;
}, { passive: true });
$('game')?.addEventListener('pointerup', (event) => {
  touchPoints.delete(event.pointerId);
  cockpitPointerX = null;
  cockpitPointerY = null;
  if (touchPoints.size < 2) pinchDistance = 0;
});
$('game')?.addEventListener('pointercancel', (event) => {
  touchPoints.delete(event.pointerId);
  cockpitPointerX = null;
  cockpitPointerY = null;
  if (touchPoints.size < 2) pinchDistance = 0;
});
$('game')?.addEventListener('wheel', (event) => {
  if (!game.started || camSet[camIndex]?.id !== 'cockpit' || (!event.ctrlKey && !event.shiftKey && !event.altKey)) return;
  event.preventDefault();
  const now = performance.now();
  if (now < nextViewGestureAt) return;
  nextViewGestureAt = now + 80;
  if (event.ctrlKey) cockpitFov = clamp(cockpitFov - event.deltaY * 0.035, 55, 100);
  else if (event.altKey) cockpitOffsetY = clamp(cockpitOffsetY - event.deltaY * 0.0015, -0.18, 0.28);
  else cockpitOffset = clamp(cockpitOffset + (event.deltaX || event.deltaY) * 0.002, 0, 0.84);
}, { passive: false });

function touchDistance() {
  const [a, b] = [...touchPoints.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ---------- Camera presets ----------
// Coordinates are car-local: +x right, +y up, -z forward (the car's nose points to -z).
// Values below are for a 5.02 m car; x/z are scaled by each car's targetLength.
// Override per car with CONFIG.cars.<id>.cameras = { front3qR: { pos: [...], look: [...], fov: 60 } }.
const DEFAULT_CAMERAS = [
  // Behind the car: world-space smoothing gives the elastic "chase" feel.
  { id: 'rear',     name: 'CLOSE REAR',          pos: [0, 1.5, 4.9],        look: [0, 0.9, -2.5], smooth: 8 },

  // Cameras ahead of or beside the car are `rigid`: smoothed in car space so they
  // never lag behind (a lagging camera ahead of the car would get run over).
  { id: 'front3qR', name: 'FRONT 3/4 · RIGHT',   pos: [3.4, 1.35, -6.4],    look: [0, 0.65, 0.3], rigid: true },
  { id: 'front3qL', name: 'FRONT 3/4 · LEFT',    pos: [-3.4, 1.35, -6.4],   look: [0, 0.65, 0.3], rigid: true },

  // Reference shot 1: low, head-on, long lens (narrow fov = compressed, heroic).
  { id: 'lowFront', name: 'LOW FRONT',           pos: [0, 0.45, -6.5],      look: [0, 0.62, 0],   rigid: true, fov: 18, fixedFov: true },

  // Reference shot 2: wheel level, wide lens, tilted horizon, looking back at the front corner.
  { id: 'wheelR',   name: 'WHEEL VIEW · RIGHT',  pos: [2.1, 0.32, -3.6],    look: [0.6, 0.55, -1.6], rigid: true, fov: 70, fixedFov: true, roll: -7 },
  { id: 'wheelL',   name: 'WHEEL VIEW · LEFT',   pos: [-2.1, 0.32, -3.6],   look: [-0.6, 0.55, -1.6], rigid: true, fov: 70, fixedFov: true, roll: 7 },

  { id: 'hood',     name: 'HOOD',                pos: [0, 0.75, -2.0],      look: [0, 0.6, -20],  rigid: true }
];

function makeCameraSet(carCfg) {
  const k = (carCfg.targetLength || 5.02) / 5.02;
  const scaled = (p) => [p[0] * k, p[1], p[2] * k];

  const extras = DEFAULT_CAMERAS.map((def) => {
    const o = carCfg.cameras?.[def.id] || {};
    return {
      ...def,
      ...o,
      pos: o.pos || scaled(def.pos),
      look: o.look || scaled(def.look)
    };
  });

  return [
    { id: 'chase', name: 'CHASE', pos: carCfg.chase, look: carCfg.chaseLook, smooth: 6 },
    ...extras,
    { id: 'cockpit', name: 'COCKPIT', pos: carCfg.cockpit,
      look: [carCfg.cockpit[0], carCfg.cockpit[1], -20], smooth: 0 }
  ];
}

function selectCamera(index) {
  if (!camSet.length) return;
  camIndex = (index + camSet.length) % camSet.length;
  text(
    'viewSubtitle',
    camSet[camIndex].name + ' CAMERA · C NEXT · V PREVIOUS · 1-' + camSet.length + ' SELECT'
  );
}

function cycleCamera(dir) { selectCamera(camIndex + dir); }
function toggleCamera() { cycleCamera(1); }
function selectCockpitView() {
  const cockpit = camSet.findIndex((cameraPreset) => cameraPreset.id === 'cockpit');
  if (cockpit >= 0) {
    cockpitOffset = 0.84;
    selectCamera(cockpit);
  }
}

// Direct selection (1-6) and previous camera (V).
addEventListener('keydown', (e) => {
  if (!game.started || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.key === 'v' || e.key === 'V') { cycleCamera(-1); return; }
  if (e.key === 'l' || e.key === 'L') {
    headlightsOn = !headlightsOn;
    lightsMsgUntil = performance.now() + 2000;
    return;
  }
  const n = Number(e.key);
  if (Number.isInteger(n) && n >= 1 && n <= camSet.length) selectCamera(n - 1);
});

// ---------- Boot, phase 1: engine (runs at page load) ----------
// Loads everything that does NOT depend on the chosen route: car model, route list, music.
async function bootEngine() {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);

  const part = { car: 0, routes: 0 };
  let label = 'Loading';
  const report = () => emit('hood:load-progress', { p: 0.85 * part.car + 0.15 * part.routes, label });

  // Music keeps downloading in the background; the radio streams if it isn't finished.
  preloadMusic(() => {}).catch(() => {});

  const [gltf, routesData] = await Promise.all([
    loader.loadAsync(C.car.model, (e) => {
      if (e.lengthComputable) {
        part.car = e.loaded / e.total;
        label = 'Loading the car';
        report();
      }
    }),
    fetch(C.routes.file)
      .then((r) => {
        if (!r.ok) throw new Error('routes HTTP ' + r.status);
        return r.json();
      })
      .then((d) => { part.routes = 1; report(); return d; })
  ]);

  engine = { gltf, routesData, loader };
  game.routes = routesData.routes.map((r) => r.id);

  // Car list for the splash picker, straight from CONFIG.cars.
  game.cars = Object.entries(C.cars || {}).map(([id, c]) => ({ id, name: c.name || id }));
  game.defaultCar = C.defaultCar && C.cars?.[C.defaultCar] ? C.defaultCar : game.cars[0]?.id;
  emit('hood:cars', { cars: game.cars, defaultCar: game.defaultCar });

  game.ready = true;
  emit('hood:load-progress', { p: 1, label: 'Ready' });
  console.log('[HOOD] Engine ready. Waiting for a route.');
  window.dispatchEvent(new Event('hood:game-ready'));

  // A refresh must always return to the setup screen, so drop any old #/drive/<id> hash.
  if (location.hash.startsWith('#/drive/')) {
    history.replaceState(null, '', location.pathname + location.search);
  }

  // Dev / test shortcut only: ?route=state-house-eastbound[&car=subaru][&autostart]
  const qs = new URLSearchParams(location.search);
  const want = qs.get('route');

  if (want) {
    await loadRoute(want, { carId: qs.get('car') || undefined, mode: qs.get('mode') || undefined });
    if (qs.has('autostart')) requestSessionStart();
  }
}

// ---------- Boot, phase 2: route (runs when the player picks a road) ----------
// Builds the world, meshes and simulation for ONE route, reporting progress to the splash.
async function loadRoute(routeId, opts = {}) {
  // Never bail out silently: the splash is waiting for READY or ERROR.
  if (!game.ready) {
    console.warn('[HOOD] loadRoute ignored: engine not ready');
    emit('hood:route-error', { message: 'Engine is not ready yet' });
    return;
  }
  if (game.routeReady) {
    console.log('[HOOD] loadRoute: route already ready, re-announcing');
    emit('hood:route-ready', { routeId: game.route?.id });
    return;
  }
  if (game.routeLoading) {
    console.log('[HOOD] loadRoute ignored: already loading');
    return;
  }

  game.routeLoading = true;
  const added = [];

  const progress = async (p, label) => {
    emit('hood:route-progress', { routeId, p, label });
    await nextFrame();
  };

  try {
    const def = engine.routesData.routes.find((r) => r.id === routeId);
    if (!def) throw new Error('unknown route "' + routeId + '"');
    const route = buildRoute(def);
    game.route = route;

    // Car + mode chosen on the splash. Per-car overrides live in CONFIG.cars (optional).
    const carId = opts.carId || C.defaultCar || 'dodge';
    const carCfg = { ...C.car, ...(C.cars?.[carId] || {}) };
    if (!C.cars?.[carId]) {
      console.warn('[HOOD] No CONFIG.cars.' + carId + ' entry; using CONFIG.car.');
    }
    game.session = { carId, routeId, mode: opts.mode || 'free-drive' };
    game.race = null;

    camSet = makeCameraSet(carCfg);
    selectCamera(0);
    console.log('[HOOD] Session:', game.session);

    await progress(0.03, 'Reading the road');
    const tile = await fetch(def.tile || C.map.tile).then((response) => {
      if (!response.ok) throw new Error('tile HTTP ' + response.status);
      return response.json();
    });

    await progress(0.2, 'Mapping the streets');
    const world = new StaticWorld(tile);
    game.world = world;

    await progress(0.32, 'Laying the tarmac');
    const roadMeshes = [buildRoadMesh(tile.roads), buildRouteMarkings(route)];
    added.push(...roadMeshes);
    scene.add(...roadMeshes);

    await progress(0.45, 'Raising the buildings');
    const buildingMesh = buildBuildingMesh(tile.buildings);
    added.push(buildingMesh);
    scene.add(buildingMesh);

    await progress(0.65, 'Parking the car');
    let carGltf = engine.gltf;
    if (carCfg.model && carCfg.model !== C.car.model) {
      carGltf = await engine.loader.loadAsync(carCfg.model);
    }
    const carTitle = document.querySelector('.hud.top h1');
    if (carTitle && carCfg.name) carTitle.textContent = carCfg.name.toUpperCase();

    const car = rigCar(carGltf.scene, {
      targetLength: carCfg.targetLength,
      headingOffset: carCfg.headingOffset
    });
    rig.add(car.root);
    added.push(car.root);

    // Steering wheel + lights are optional extras: a failure here must never block the route.
    let steeringWheel = null;
    let lights = { update() {} };
    try {
      steeringWheel = rigSteeringWheel(car.root, carCfg);
      lights = createCarLights(car.root, carCfg);
    } catch (err) {
      console.warn('[HOOD] car extras failed (steering wheel / lights):', err);
    }
    window.__hoodFlash = (name) => flashMesh(car.root, name);
    window.__hoodScan = (radius) => scanNearby(car.root, carCfg, radius);
    window.__hoodPreview = (c, r, t) => previewSplit(car.root, carCfg, c, r, t);
    // Current cut, kept so it can be nudged step by step.
    const sp0 = carCfg.steeringWheel?.split || {};
    const split = {
      center: [...(sp0.center || [-0.42, 0.90, -0.40])],
      radius: sp0.radius ?? 0.19,
      thickness: sp0.thickness ?? 0.14
    };
    const applySplit = () => {
      steeringWheel?.dispose?.();
      steeringWheel = rigSteeringWheel(car.root, {
        ...carCfg,
        steeringWheel: { ...(carCfg.steeringWheel || {}), split: { ...split, center: [...split.center] } }
      });
      previewSplit(car.root, carCfg, split.center, split.radius, split.thickness);
      console.log('[HOOD] split =', JSON.stringify(split));
      return !!steeringWheel;
    };
    window.__hoodSplit = (c, r, t) => {
      if (c) split.center = [...c];
      if (r != null) split.radius = r;
      if (t != null) split.thickness = t;
      return applySplit();
    };
    // Move/resize the cut by small steps, e.g. __hoodNudge(0, 0.02, 0) raises it 2 cm.
    // Arguments: dx (right), dy (up), dz (towards the front, negative), dr (radius), dt (thickness).
    window.__hoodNudge = (dx = 0, dy = 0, dz = 0, dr = 0, dt = 0) => {
      split.center[0] += dx; split.center[1] += dy; split.center[2] += dz;
      split.radius = Math.max(0.02, split.radius + dr);
      split.thickness = Math.max(0.02, split.thickness + dt);
      return applySplit();
    };
    window.__hoodSplitUndo = () => {
      steeringWheel?.dispose?.(); steeringWheel = null;
      previewSplit(car.root, carCfg, null);
    };
    window.__hoodSplitShow = () => applySplit();   // rebuild the current cut and preview

    // The route decides where the car starts: left lane, facing the direction of travel.
    const s = createVehicle(route.spawn.x, route.spawn.z, route.spawn.psi);
    game.sim = s;

    let impactShake = 0;
    let lastImpact = 0;
    let prog = { s: 0, dist: 0 };
    let arrivedAt = 0;
    const checkpoints = (route.checkpoints || []).map((checkpoint) => ({
      ...checkpoint,
      s: trackProgress(route.path, checkpoint.x, checkpoint.z).s
    }));
    if (game.session.mode === 'race' && checkpoints.length) {
      game.race = { checkpoints, nextCheckpoint: 0, startedAt: 0, finishedAt: 0 };
    }
    const endName = (route.landmarks.find((l) => l.at === 'end') || {}).name || 'the end of the route';
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
      local: new THREE.Vector3(),   // camera position in car space (for rigid cameras)
      look: new THREE.Vector3(),
      init: false
    };
    const v3 = new THREE.Vector3();

    const render = (alpha, dtSec) => {
      controls = input.poll(dtSec);

      rig.position.set(s.x, 0, s.z);
      rig.rotation.y = -s.psi;

      car.update(s.wheelAngle, s.wheelSpin);

      steeringWheel?.update(controls.steer);
      lights.update(dtSec, {
        head: headlightsOn,
        brake: (controls.brake > 0.05 && !s.reverse) || (controls.handbrake && s.speed > 1),
        reverse: s.reverse
      });

      // Route progress
      prog = trackProgress(route.path, s.x, s.z, prog.s);
      const left = Math.max(0, route.path.length - prog.s);
      text('routeLeft', left > 950 ? (left / 1000).toFixed(2) + ' KM' : Math.round(left / 10) * 10 + ' M');
      $('routeFill').style.width = (prog.s / route.path.length) * 100 + '%';
      const race = game.race;
      if (race?.startedAt) {
        while (race.nextCheckpoint < race.checkpoints.length) {
          const checkpoint = race.checkpoints[race.nextCheckpoint];
          if (prog.s < checkpoint.s - 8 || Math.hypot(s.x - checkpoint.x, s.z - checkpoint.z) > 12) break;
          race.nextCheckpoint++;
        }
      }
      if (!arrivedAt && left < 15 && prog.dist < 8 && (!race || race.nextCheckpoint === race.checkpoints.length)) {
        arrivedAt = performance.now();
      }
      if (race?.startedAt) {
        if (arrivedAt && !race.finishedAt) race.finishedAt = arrivedAt;
        const elapsed = Math.max(0, ((race.finishedAt || performance.now()) - race.startedAt) / 1000);
        const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const seconds = (elapsed % 60).toFixed(1).padStart(4, '0');
        text('sprintTime', `${minutes}:${seconds}`);
        text('sprintCheckpoint', race.nextCheckpoint < race.checkpoints.length
          ? `${race.nextCheckpoint + 1}/${race.checkpoints.length}`
          : 'FINISH');
        text('sprintCheckpointName', race.nextCheckpoint < race.checkpoints.length
          ? race.checkpoints[race.nextCheckpoint].name
          : 'Finish line');
      }
      $('sprintHud').hidden = !race;

      car.root.rotation.x = damp(car.root.rotation.x, clamp(s.aLong * 0.0042, -0.05, 0.04), 5, dtSec);
      car.root.rotation.z = damp(car.root.rotation.z, clamp(-s.aLat * 0.0032, -0.07, 0.07), 4, dtSec);

      impactShake = damp(impactShake, 0, 4, dtSec);
      const sh = impactShake * 0.15 * Math.sin(performance.now() * 0.08);

      const cp = camSet[camIndex];
      const cockpit = cp.id === 'cockpit';
      const cameraPos = cockpit ? [cp.pos[0] + cockpitOffset, cp.pos[1] + cockpitOffsetY, cp.pos[2]] : cp.pos;
      const cameraLook = cockpit ? [cp.look[0] + cockpitOffset, cp.look[1] + cockpitOffsetY * 0.25, cp.look[2]] : cp.look;

      if (cp.rigid || cp.smooth === 0) {
        // Car-space smoothing: sticks to the car exactly, only eases between presets.
        if (!cam.init) cam.local.set(...cameraPos);
        else cam.local.lerp(v3.set(...cameraPos), cp.smooth === 0 ? 1 : 1 - Math.exp(-8 * dtSec));
        cam.pos.copy(rig.localToWorld(v3.copy(cam.local)));
      } else {
        // World-space smoothing: the camera trails the car (elastic chase feel).
        const want = rig.localToWorld(v3.set(...cameraPos));
        if (!cam.init) cam.pos.copy(want);
        else cam.pos.lerp(want, 1 - Math.exp(-cp.smooth * dtSec));
        cam.local.copy(rig.worldToLocal(v3.copy(cam.pos)));
      }
      cam.init = true;

      camera.position.copy(cam.pos);
      camera.position.y += sh;

      camera.lookAt(rig.localToWorld(v3.set(...cameraLook)));
      if (cp.roll) camera.rotateZ(THREE.MathUtils.degToRad(cp.roll));   // tilt the horizon

      // Long/wide-lens presets keep their fov; the others widen with speed.
      const targetFov = cp.id === 'cockpit'
        ? cockpitFov
        : cp.fixedFov
          ? cp.fov
          : (cp.fov || 72) + s.speed * 0.14 + (s.boosting ? 8 : 0);
      camera.fov = damp(camera.fov, targetFov, 6, dtSec);

      camera.updateProjectionMatrix();

      text('speed', String(Math.round(s.speed * 3.6)).padStart(3, '0'));
      text('rpmText', Math.round(s.rpm / 10) * 10 + ' RPM');
      $('rpmFill').style.width = (s.rpm / CAR.redline) * 100 + '%';

      text(
        'gear',
        s.reverse ? 'R' : s.speed < 0.5 && s.throttle < 0.05 ? 'N' : 'D' + (s.gear + 1)
      );

      text('steering', `STEERING: ${Math.round(controls.steer * 30)}°`);
      $('boostFill').style.width = s.nitro * 100 + '%';
      text('boostPercent', Math.round(s.nitro * 100) + '%');

      text(
        'message',
        performance.now() < lightsMsgUntil
          ? 'Headlights ' + (headlightsOn ? 'ON' : 'OFF') + ' · L to toggle'
          : arrivedAt && performance.now() - arrivedAt < 7000
          ? 'Arrived · ' + endName + ' · M for routes'
          : !surface.onRoad
            ? 'Off road — grip reduced'
            : s.drifting
              ? 'Drifting — counter-steer!'
              : lastImpact > 6 && impactShake > 0.2
                ? 'Crash!'
                : 'Driving · C camera · R radio'
      );

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

    await progress(0.78, 'Warming up the engine');
    await renderer.compileAsync(scene, camera);

    // One initial frame (does NOT start the driving loop).
    render(0, C.sim.fixedDt);

    const loading = $('loading');
    if (loading) {
      loading.style.opacity = '0';
      setTimeout(() => { loading.style.display = 'none'; }, 450);
    }

    await progress(0.95, 'Almost there');
    game.routeReady = true;
    game.routeLoading = false;
    console.log('[HOOD] Route ready:', route.id);
    emit('hood:route-ready', { routeId });

    // Honour a start request that arrived while the route was still preparing.
    beginSession();
  } catch (e) {
    // Undo the half-built route: remove each object from whichever parent holds it.
    for (const o of added) o.parent?.remove(o);
    loop?.stop?.();
    loop = null;
    game.loop = null;
    game.routeReady = false;
    game.routeLoading = false;
    game.route = null;
    game.world = null;
    game.sim = null;
    game.race = null;
    game.error = String(e);
    console.error('[HOOD] Route load failed:', e);
    text('message', 'Failed to load route: ' + (e.message || e));
    emit('hood:route-error', { message: e.message || String(e) });
  }
}

window.addEventListener('hood:select-route', (e) => loadRoute(e.detail?.routeId, e.detail));

// Back to the route picker. A reload is the safest way to release GPU/audio state;
// the splash reads this flag and skips the intro.
function changeRoute() {
  try { sessionStorage.setItem('hood.returnToRoutes', '1'); } catch { /* storage blocked: intro plays again */ }

  const q = new URLSearchParams(location.search);
  q.delete('route');
  q.delete('autostart');
  const qs = q.toString();

  // Also drops the #/drive/<id> hash so the route doesn't auto-load again.
  history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  location.reload();
}

bootEngine().catch((e) => {
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
    new CustomEvent('hood:boot-error', { detail: { message: e.message || String(e) } })
  );
});
