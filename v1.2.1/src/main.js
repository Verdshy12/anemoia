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
import { buildRoadMesh, buildBuildingMesh, buildRouteMarkings } from './world/meshes.js';
import { buildRoute, trackProgress } from './world/routes.js';
import { preloadMusic } from '../music/preload.js';
import { startAudio, updateAudio } from './audio/audio.js';

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
let cameraMode = 'chase';

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

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 600);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
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

    startAudio();

    if (k === 'c') toggleCamera();
    if (k === 'm') changeRoute();
  }
});

// The splash lives in an iframe, so its clicks never reach this document.
// Unlock audio on a deliberate interaction with the game page.
addEventListener('pointerdown', () => {
  if (game.started) startAudio();
});

$('routesBtn')?.addEventListener('click', () => { if (game.started) changeRoute(); });
$('camBtn')?.addEventListener('click', () => { if (game.started) toggleCamera(); });

function toggleCamera() {
  cameraMode = cameraMode === 'chase' ? 'cockpit' : 'chase';

  text(
    'viewSubtitle',
    cameraMode === 'chase'
      ? 'CHASE CAMERA · PRESS C FOR COCKPIT'
      : 'FIRST-PERSON · PRESS C FOR CHASE CAMERA'
  );
}

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
    console.log('[HOOD] Session:', game.session);

    await progress(0.03, 'Reading the road');
    const tile = await fetch(C.map.tile).then((response) => {
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

    // The route decides where the car starts: left lane, facing the direction of travel.
    const s = createVehicle(route.spawn.x, route.spawn.z, route.spawn.psi);
    game.sim = s;

    let impactShake = 0;
    let lastImpact = 0;
    let prog = { s: 0, dist: 0 };
    let arrivedAt = 0;
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
      look: new THREE.Vector3(),
      init: false
    };
    const v3 = new THREE.Vector3();

    const render = (alpha, dtSec) => {
      controls = input.poll(dtSec);

      rig.position.set(s.x, 0, s.z);
      rig.rotation.y = -s.psi;

      car.update(s.wheelAngle, s.wheelSpin);

      // Route progress
      prog = trackProgress(route.path, s.x, s.z, prog.s);
      const left = Math.max(0, route.path.length - prog.s);
      text('routeLeft', left > 950 ? (left / 1000).toFixed(2) + ' KM' : Math.round(left / 10) * 10 + ' M');
      $('routeFill').style.width = (prog.s / route.path.length) * 100 + '%';
      if (!arrivedAt && left < 15 && prog.dist < 8) arrivedAt = performance.now();

      car.root.rotation.x = damp(car.root.rotation.x, clamp(s.aLong * 0.0042, -0.05, 0.04), 5, dtSec);
      car.root.rotation.z = damp(car.root.rotation.z, clamp(-s.aLat * 0.0032, -0.07, 0.07), 4, dtSec);

      impactShake = damp(impactShake, 0, 4, dtSec);
      const sh = impactShake * 0.15 * Math.sin(performance.now() * 0.08);

      const want = v3.set(...(cameraMode === 'chase' ? carCfg.chase : carCfg.cockpit));
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
              ? carCfg.chaseLook
              : [carCfg.cockpit[0], carCfg.cockpit[1], -20])
          )
        )
      );

      camera.fov = damp(camera.fov, 72 + s.speed * 0.14 + (s.boosting ? 8 : 0), 4, dtSec);
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
        arrivedAt && performance.now() - arrivedAt < 7000
          ? 'Arrived · ' + endName + ' · M for routes'
          : !surface.onRoad
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
