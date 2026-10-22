import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js";

const $ = (id) => document.getElementById(id);
const { clamp, damp } = THREE.MathUtils;

// ---------- Configuration ----------
const MODEL_CONFIG = {
  path: "./models/dodge/scene.gltf",
  targetLength: 5.02,
  headingOffset: Math.PI,
  cockpitDriverPos: new THREE.Vector3(-0.42, 1.18, 0.15),
  chaseCamPos: new THREE.Vector3(0, 2.35, 6.8),
  chaseLookTarget: new THREE.Vector3(0, 1.0, -4.0),
  gltfSteerAxis: "x"
};

const MAP_CONFIG = {
  jsonPath: "./data/nairobi-osm.json",
  centerLat: -1.2877107,
  centerLon: 36.8088354,
  sizeMeters: 500,
  roadWidth: 6.5
};

// ---------- Scene & Renderer ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x91b9d1);
scene.fog = new THREE.Fog(0x91b9d1, 75, 260);

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: "low-power",
  failIfMajorPerformanceCaveat: false
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = false;

$("game").appendChild(renderer.domElement);

renderer.domElement.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  console.error("WebGL context lost. The browser/GPU stopped rendering.");
  if ($("message")) {
    $("message").textContent =
    "Graphics stopped. Reload the page and check the browser console.";
  }
});

renderer.domElement.addEventListener("webglcontextrestored", () => {
  console.info("WebGL context restored.");
});

scene.add(new THREE.HemisphereLight(0xd9edff, 0x424034, 2));

const sun = new THREE.DirectionalLight(0xffe0b5, 2.5);
sun.position.set(-30, 50, 20);
sun.castShadow = false;
scene.add(sun);

// ---------- Materials ----------
const std = (c, r = 0.9, m = 0) =>
new THREE.MeshStandardMaterial({
  color: c,
  roughness: r,
  metalness: m
});

const roadMat = std(0x303338, 0.95);
const serviceRoadMat = std(0x3b3d3f, 0.98);
const groundMat = std(0x52634a, 1);
const darkMat = std(0x101317, 0.4, 0.3);
const trimMat = std(0x252b31, 0.38, 0.55);
const paint = std(0xe8590c, 0.28, 0.55);

// ---------- Player Rig & Camera ----------
const EYE = 1.2;
const rig = new THREE.Group();
rig.position.set(0, 0, 0);
scene.add(rig);

let cameraMode = "cockpit";
let gltfLoaded = false;

const camera = new THREE.PerspectiveCamera(
  75, innerWidth / innerHeight, 0.1, 500
);
camera.position.set(0, EYE, 0);
camera.rotation.order = "YXZ";
rig.add(camera);

// ---------- Cockpit ----------
const dash = new THREE.Group();
camera.add(dash);

const hoodGroup = new THREE.Group();
dash.add(hoodGroup);

function bar(parent, x, y, z, w, h, d, material = trimMat) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
                              material
  );
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

bar(hoodGroup, 0, -0.56, -3, 2.05, 0.07, 2.6, paint);
bar(hoodGroup, -0.2, -0.515, -3, 0.16, 0.005, 2.6);
bar(hoodGroup, 0.2, -0.515, -3, 0.16, 0.005, 2.6);
bar(hoodGroup, 0, -0.46, -2.5, 0.55, 0.14, 0.8, paint);

const wheelColumn = new THREE.Group();
wheelColumn.position.set(-0.52, -0.62, -1.02);
wheelColumn.rotation.y = Math.PI / 2;
wheelColumn.rotation.z = -0.17;
dash.add(wheelColumn);

const wheel = new THREE.Group();
wheelColumn.add(wheel);

const rimMesh = new THREE.Mesh(
  new THREE.TorusGeometry(0.36, 0.045, 12, 48),
                               darkMat
);
rimMesh.rotation.y = Math.PI / 2;
wheel.add(rimMesh);

for (let i = 0; i < 3; i++) {
  const spoke = new THREE.Mesh(
    new THREE.BoxGeometry(0.045, 0.32, 0.035),
                               trimMat
  );
  const angle = i * 2 * Math.PI / 3;
  spoke.position.set(
    0,
    Math.cos(angle) * 0.16,
                     Math.sin(angle) * 0.16
  );
  spoke.rotation.x = angle;
  wheel.add(spoke);
}

const placeholderFenders = new THREE.Group();
rig.add(placeholderFenders);

for (const side of [-1, 1]) {
  const fender = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.5, 2.6),
                                paint
  );
  fender.position.set(side * 1.4, 0.6, 2.2);
  placeholderFenders.add(fender);
}

// ---------- Side Mirrors ----------
// Live mirror rendering is disabled in this prototype to reduce GPU load.
for (const side of [-1, 1]) {
  const mirror = new THREE.Group();
  mirror.position.set(side * 1.62, -0.2, -1.5);
  mirror.rotation.y = -side * 0.4;
  dash.add(mirror);

  bar(mirror, 0, 0, 0, 0.6, 0.34, 0.04, darkMat);
}

// ---------- Load Dodge GLTF ----------
const carRoot = new THREE.Group();
rig.add(carRoot);

const carParts = {
  frontLeftWheel: null,
  frontRightWheel: null,
  rearWheels: [],
  steeringWheel: null
};

const loader = new GLTFLoader();

loader.load(
  MODEL_CONFIG.path,
  (gltf) => {
    const carModel = gltf.scene;
    const rawBox = new THREE.Box3().setFromObject(carModel);
    const rawSize = rawBox.getSize(new THREE.Vector3());
    const maxDim = Math.max(rawSize.x, rawSize.y, rawSize.z);
    const autoScale =
    maxDim > 0 ? MODEL_CONFIG.targetLength / maxDim : 1;

    carModel.scale.setScalar(autoScale);
    carModel.rotation.y = MODEL_CONFIG.headingOffset;
    carModel.updateMatrixWorld(true);

    const alignedBox = new THREE.Box3().setFromObject(carModel);
    const alignedCenter = alignedBox.getCenter(new THREE.Vector3());

    carModel.position.x -= alignedCenter.x;
    carModel.position.z -= alignedCenter.z;
    carModel.position.y -= alignedBox.min.y;

    carModel.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = false;
        child.receiveShadow = false;

        if (child.material) {

          // Diagnostic fix: disable transmission on imported
          // physical materials to avoid the transmission render pass.
          const matsForShaderFix = Array.isArray(child.material)
          ? child.material
          : [child.material];

          for (const mat of matsForShaderFix) {
            if (mat && mat.isMeshPhysicalMaterial && mat.transmission > 0) {
              mat.transmission = 0;
              mat.needsUpdate = true;
            }
          }

          const matName = (child.material.name || "").toLowerCase();
          const meshName = (child.name || "").toLowerCase();

          if (
            matName.includes("glass") ||
            matName.includes("window") ||
            meshName.includes("glass") ||
            meshName.includes("window")
          ) {
            child.material.transparent = true;
            if (child.material.opacity > 0.6) {
              child.material.opacity = 0.35;
            }
          }
        }
      }

      const name = (child.name || "").toLowerCase();

      if (name.includes("steer") && !carParts.steeringWheel) {
        carParts.steeringWheel = child;
      } else if (
        name.includes("wheel") ||
        name.includes("tire") ||
        name.includes("rim")
      ) {
        if (
          (name.includes("fl") ||
          (name.includes("front") && name.includes("left"))) &&
          !carParts.frontLeftWheel
        ) {
          carParts.frontLeftWheel = child;
        } else if (
          (name.includes("fr") ||
          (name.includes("front") && name.includes("right"))) &&
          !carParts.frontRightWheel
        ) {
          carParts.frontRightWheel = child;
        } else if (
          name.includes("rl") ||
          name.includes("rr") ||
          name.includes("rear") ||
          name.includes("back")
        ) {
          carParts.rearWheels.push(child);
        }
      }
    });

    carRoot.add(carModel);
    gltfLoaded = true;
    hoodGroup.visible = false;
    placeholderFenders.visible = false;

    if (carParts.steeringWheel) {
      wheelColumn.visible = false;
    }

    console.info("Dodge model loaded successfully.");
  },
  undefined,
  (error) => {
    console.error("Could not load Dodge model:", error);
    if ($("message")) {
      $("message").textContent =
      "Car model failed to load. Check models/dodge/scene.gltf.";
    }
  }
);

// ---------- Camera Toggle ----------
function toggleCameraMode() {
  cameraMode = cameraMode === "cockpit" ? "chase" : "cockpit";
  dash.visible = cameraMode === "cockpit";

  if ($("viewSubtitle")) {
    $("viewSubtitle").textContent =
    cameraMode === "cockpit"
    ? "FIRST-PERSON DRIVING · PRESS C FOR CHASE CAMERA"
    : "CHASE CAMERA · PRESS C FOR COCKPIT";
  }
}

// ---------- Nairobi OSM Map ----------
const roadBatches = new Map();
const buildingBatches = new Map();
const edgeTransforms = [];
const unitBoxGeometry = new THREE.BoxGeometry(1, 1, 1);
const edgeMaterial = new THREE.MeshBasicMaterial({ color: 0xf6f0d5 });
const mapDummy = new THREE.Object3D();

let mapReady = false;

function geoToLocal(lat, lon) {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon =
  111320 * Math.cos(MAP_CONFIG.centerLat * Math.PI / 180);

  return new THREE.Vector3(
    (lon - MAP_CONFIG.centerLon) * metersPerDegreeLon,
                           0,
                           -(lat - MAP_CONFIG.centerLat) * metersPerDegreeLat
  );
}

function roadWidthFor(highway) {
  const widths = {
    motorway: 12,
    trunk: 10,
    primary: 9,
    secondary: 8,
    tertiary: 7,
    unclassified: 6,
    residential: 5.5,
    living_street: 4.5,
    service: 4
  };

  return widths[highway] || MAP_CONFIG.roadWidth;
}

function makeRoadSegment(a, b, width, material) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);

  if (length < 0.5) return;

  const rotation = Math.atan2(dx, dz);
  const key =
  `${width}|${material === serviceRoadMat ? "service" : "main"}`;

  if (!roadBatches.has(key)) {
    roadBatches.set(key, {
      width,
      material,
      transforms: []
    });
  }

  roadBatches.get(key).transforms.push({
    x: (a.x + b.x) / 2,
                                       y: 0.005,
                                       z: (a.z + b.z) / 2,
                                       rotation,
                                       scaleX: width,
                                       scaleY: 0.12,
                                       scaleZ: length + 0.35
  });

  for (const side of [-1, 1]) {
    edgeTransforms.push({
      x: (a.x + b.x) / 2 +
      Math.cos(rotation) * side * (width / 2 - 0.12),
                        y: 0.075,
                        z: (a.z + b.z) / 2 -
                        Math.sin(rotation) * side * (width / 2 - 0.12),
                        rotation,
                        scaleX: 0.09,
                        scaleY: 0.025,
                        scaleZ: length
    });
  }
}

function addBuilding(nodes, way) {
  const refs = way.nodes || [];

  if (refs.length < 4 || refs[0] !== refs[refs.length - 1]) {
    return;
  }

  const points = refs.map((id) => nodes.get(id)).filter(Boolean);
  if (points.length < 4) return;

  const local = points.map((n) => geoToLocal(n.lat, n.lon));
  const minX = Math.min(...local.map((p) => p.x));
  const maxX = Math.max(...local.map((p) => p.x));
  const minZ = Math.min(...local.map((p) => p.z));
  const maxZ = Math.max(...local.map((p) => p.z));

  const width = maxX - minX;
  const depth = maxZ - minZ;
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const half = MAP_CONFIG.sizeMeters / 2;

  if (
    centerX < -half || centerX > half ||
    centerZ < -half || centerZ > half
  ) return;

  if (width < 2 || depth < 2 || width > 100 || depth > 100) {
    return;
  }

  const tags = way.tags || {};
  const levels = Number(tags["building:levels"]);
  const taggedHeight = Number.parseFloat(tags.height);

  const height =
  Number.isFinite(taggedHeight) && taggedHeight > 0
  ? clamp(taggedHeight, 3, 45)
  : Number.isFinite(levels) && levels > 0
  ? clamp(levels * 3.1, 3, 45)
  : 8;

  const colors = [
    0xb8b2a4, 0xc8c0ad, 0xaaa9a1, 0xd1c7b5, 0x8f999a
  ];

  const color = colors[Math.abs(Number(way.id) || 0) % colors.length];

  if (!buildingBatches.has(color)) {
    buildingBatches.set(color, {
      material: std(color, 0.95),
                        transforms: []
    });
  }

  buildingBatches.get(color).transforms.push({
    x: centerX,
    y: height / 2,
    z: centerZ,
    scaleX: Math.max(2, width),
                                             scaleY: height,
                                             scaleZ: Math.max(2, depth)
  });
}

function flushInstances() {
  for (const batch of roadBatches.values()) {
    const mesh = new THREE.InstancedMesh(
      unitBoxGeometry,
      batch.material,
      batch.transforms.length
    );

    batch.transforms.forEach((t, i) => {
      mapDummy.position.set(t.x, t.y, t.z);
      mapDummy.rotation.set(0, t.rotation, 0);
      mapDummy.scale.set(t.scaleX, t.scaleY, t.scaleZ);
      mapDummy.updateMatrix();
      mesh.setMatrixAt(i, mapDummy.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    scene.add(mesh);
  }

  if (edgeTransforms.length) {
    const edges = new THREE.InstancedMesh(
      unitBoxGeometry,
      edgeMaterial,
      edgeTransforms.length
    );

    edgeTransforms.forEach((t, i) => {
      mapDummy.position.set(t.x, t.y, t.z);
      mapDummy.rotation.set(0, t.rotation, 0);
      mapDummy.scale.set(t.scaleX, t.scaleY, t.scaleZ);
      mapDummy.updateMatrix();
      edges.setMatrixAt(i, mapDummy.matrix);
    });

    edges.instanceMatrix.needsUpdate = true;
    edges.frustumCulled = false;
    scene.add(edges);
  }

  for (const batch of buildingBatches.values()) {
    const mesh = new THREE.InstancedMesh(
      unitBoxGeometry,
      batch.material,
      batch.transforms.length
    );

    batch.transforms.forEach((t, i) => {
      mapDummy.position.set(t.x, t.y, t.z);
      mapDummy.rotation.set(0, 0, 0);
      mapDummy.scale.set(t.scaleX, t.scaleY, t.scaleZ);
      mapDummy.updateMatrix();
      mesh.setMatrixAt(i, mapDummy.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    scene.add(mesh);
  }

  roadBatches.clear();
  edgeTransforms.length = 0;
  buildingBatches.clear();
}

async function loadNairobiTestArea() {
  const half = MAP_CONFIG.sizeMeters / 2;

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(
      MAP_CONFIG.sizeMeters,
      MAP_CONFIG.sizeMeters
    ),
    groundMat
  );

  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.09;
  ground.receiveShadow = false;
  scene.add(ground);

  try {
    const response = await fetch(MAP_CONFIG.jsonPath);

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}: ${MAP_CONFIG.jsonPath}`
      );
    }

    const data = await response.json();
    console.info("OSM JSON parsed:", data.elements?.length, "elements");
    const nodes = new Map();

    for (const element of data.elements || []) {
      if (
        element.type === "node" &&
        Number.isFinite(element.lat) &&
        Number.isFinite(element.lon)
      ) {
        nodes.set(element.id, element);
      }
    }

    const highwayTypes = new Set([
      "motorway", "motorway_link",
      "trunk", "trunk_link",
      "primary", "primary_link",
      "secondary", "secondary_link",
      "tertiary", "tertiary_link",
      "residential", "unclassified",
      "living_street", "service"
    ]);

    const roadWays = [];
    let roadsRendered = 0;
    let buildingsRendered = 0;

    for (const way of data.elements || []) {
      if (way.type !== "way" || !way.tags) continue;

      if (way.tags.highway && highwayTypes.has(way.tags.highway)) {
        const refs = way.nodes || [];
        const coords = refs.map((id) => nodes.get(id)).filter(Boolean);

        if (coords.length < 2) continue;

        const local = coords.map((n) => geoToLocal(n.lat, n.lon));
        const minX = Math.min(...local.map((p) => p.x));
        const maxX = Math.max(...local.map((p) => p.x));
        const minZ = Math.min(...local.map((p) => p.z));
        const maxZ = Math.max(...local.map((p) => p.z));

        if (
          maxX < -half || minX > half ||
          maxZ < -half || minZ > half
        ) continue;

        roadWays.push({ way, coords, local });

        const width = roadWidthFor(way.tags.highway);
        const material =
        way.tags.highway === "service"
        ? serviceRoadMat
        : roadMat;

        for (let i = 0; i < local.length - 1; i++) {
          const a = local[i];
          const b = local[i + 1];

          if (
            Math.max(a.x, b.x) < -half - 10 ||
            Math.min(a.x, b.x) > half + 10 ||
            Math.max(a.z, b.z) < -half - 10 ||
            Math.min(a.z, b.z) > half + 10
          ) continue;

          makeRoadSegment(a, b, width, material);
          roadsRendered++;
        }
      } else if (
        way.tags.building &&
        way.tags.building !== "no"
      ) {
        const before = buildingBatches.size;
        addBuilding(nodes, way);
        if (buildingBatches.size >= before) buildingsRendered++;
      }
    }

    flushInstances();

    // Spawn at the nearest segment of State House Avenue.
    let best = null;
    let bestDistance = Infinity;

    for (const item of roadWays) {
      if (item.way.tags.name !== "State House Avenue") continue;

      for (let i = 0; i < item.local.length - 1; i++) {
        const a = item.local[i];
        const b = item.local[i + 1];
        const midX = (a.x + b.x) / 2;
        const midZ = (a.z + b.z) / 2;
        const distance = midX * midX + midZ * midZ;

        if (distance < bestDistance) {
          bestDistance = distance;
          best = { a, b, midX, midZ };
        }
      }
    }

    if (best) {
      rig.position.set(best.midX, 0, best.midZ);

      const dx = best.b.x - best.a.x;
      const dz = best.b.z - best.a.z;

      psi = Math.atan2(dx, -dz);
      rig.rotation.y = -psi;
    } else {
      console.warn("State House Avenue not found; using fallback spawn.");
      rig.position.set(0, 0, 0);
    }

    mapReady = true;

    if ($("message")) {
      $("message").textContent =
      "Nairobi test area loaded · State House Avenue";
    }

    console.info(
      `OSM map loaded: ${roadsRendered} road segments; ` +
      `${buildingsRendered} building records.`
    );
    console.info("MAP LOADER COMPLETED");
  } catch (error) {
    console.error("Could not load Nairobi OSM JSON:", error);

    if ($("message")) {
      $("message").textContent =
      "Map failed to load. Check data/nairobi-osm.json.";
    }

    const fallbackRoad = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 600),
                                        roadMat
    );
    fallbackRoad.rotation.x = -Math.PI / 2;
    fallbackRoad.position.y = 0;
    scene.add(fallbackRoad);
  } finally {
    if ($("loading")) {
      $("loading").style.opacity = "0";
      setTimeout(() => {
        $("loading").style.display = "none";
      }, 450);
    }
  }
}

// ---------- Traffic ----------
const traffic = [];

// ---------- Driving Physics ----------
const MASS = 1900;
const G = 9.81;
const WHEEL_R = 0.34;
const FINAL = 3.09;
const WHEELBASE = 2.95;
const IDLE = 850;
const REDLINE = 6400;
const RATIOS = [4.71, 3.14, 2.1, 1.67, 1.29, 1.0, 0.84, 0.67];

const torque = (r) =>
Math.max(180, 560 * (1 - ((r - 4300) / 5200) ** 2));

let speedMs = 0;
let gear = 0;
let rpm = IDLE;
let throttle = 0;
let shiftTimer = 0;
let nitro = 1;
let steerIn = 0;
let psi = 0;
let latV = 0;
let yawRate = 0;
let aLong = 0;
let aLat = 0;
let shake = 0;
let crashCd = 0;
let fov = 75;
let wheelSpinAngle = 0;

// ---------- Engine Audio ----------
let audio = null;

function startAudio() {
  if (audio || !(window.AudioContext || window.webkitAudioContext)) {
    return;
  }

  const AudioContextClass =
  window.AudioContext || window.webkitAudioContext;

  const ctx = new AudioContextClass();
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 500;

  const master = ctx.createGain();
  master.gain.value = 0;
  lp.connect(master);
  master.connect(ctx.destination);

  const o1 = ctx.createOscillator();
  const o2 = ctx.createOscillator();
  const o3 = ctx.createOscillator();

  o1.type = "sawtooth";
  o2.type = "square";
  o3.type = "triangle";

  const g2 = ctx.createGain();
  const g3 = ctx.createGain();

  g2.gain.value = 0.5;
  g3.gain.value = 0.7;

  o1.connect(lp);
  o2.connect(g2).connect(lp);
  o3.connect(g3).connect(lp);

  const lfo = ctx.createOscillator();
  const lg = ctx.createGain();

  lfo.frequency.value = 14;
  lg.gain.value = 0.25;
  lfo.connect(lg).connect(master.gain);

  [o1, o2, o3, lfo].forEach((oscillator) => oscillator.start());

  audio = { ctx, o1, o2, o3, lp, master, lfo };

  if (ctx.state === "suspended") {
    ctx.resume().catch(console.warn);
  }
}

function updateAudio() {
  if (!audio) return;

  const f = (rpm / 60) * 4;
  const t = audio.ctx.currentTime;

  audio.o1.frequency.setTargetAtTime(f, t, 0.04);
  audio.o2.frequency.setTargetAtTime(f / 2, t, 0.04);
  audio.o3.frequency.setTargetAtTime(f * 2, t, 0.04);
  audio.lp.frequency.setTargetAtTime(
    300 + rpm * 0.25 + throttle * 700,
    t,
    0.05
  );
  audio.lfo.frequency.setTargetAtTime(f / 3, t, 0.05);
  audio.master.gain.setTargetAtTime(
    0.1 + 0.14 * throttle + 0.04 * (rpm / REDLINE),
                                    t,
                                    0.05
  );
}

// ---------- Radio / Music ----------
const RADIO_TRACKS = [
  {
    title: "Nightcall Overdrive",
    artist: "Challenger Synth FM",
    bpm: 118,
    bass: [55, 55, 65.41, 73.42, 61.74, 61.74, 49, 55],
    arp: [220, 261.63, 329.63, 440, 329.63, 261.63],
    url: null
  },
{
  title: "Hemi V8 Highway",
  artist: "Outrun 1970",
  bpm: 128,
  bass: [41.2, 41.2, 49, 55, 46.25, 46.25, 36.71, 41.2],
  arp: [164.81, 196, 246.94, 329.63, 246.94, 196],
  url: null
},
{
  title: "Midnight Canyon Run",
  artist: "R/T Electro",
  bpm: 110,
  bass: [65.41, 58.27, 49, 55, 65.41, 73.42, 82.41, 73.42],
  arp: [261.63, 329.63, 392, 523.25, 392, 329.63],
  url: null
},
{
  title: "Redline Horizon",
  artist: "Turbo Pulse",
  bpm: 136,
  bass: [49, 49, 58.27, 65.41, 73.42, 65.41, 58.27, 49],
  arp: [196, 233.08, 293.66, 392, 293.66, 233.08],
  url: null
}
];

let radioPlaying = false;
let currentTrackIndex = 0;
let radioVolume = 0.5;
let radioInterval = null;
let radioStep = 0;

const htmlAudio = new Audio();
htmlAudio.crossOrigin = "anonymous";
htmlAudio.loop = true;

function updateRadioUI() {
  const track = RADIO_TRACKS[currentTrackIndex];

  if ($("trackTitle")) {
    $("trackTitle").textContent = track.title;
  }

  if ($("trackArtist")) {
    $("trackArtist").textContent = radioPlaying
    ? track.artist
    : `${track.artist} · Paused`;
  }

  if ($("playBtn")) {
    $("playBtn").textContent = radioPlaying ? "⏸" : "▶";
    $("playBtn").classList.toggle("playing", radioPlaying);
  }
}

function playSynthStep() {
  if (!radioPlaying) return;

  startAudio();
  if (!audio || !audio.ctx) return;

  const ctx = audio.ctx;

  if (ctx.state === "suspended") {
    ctx.resume().catch(console.warn);
  }

  const track = RADIO_TRACKS[currentTrackIndex];
  const now = ctx.currentTime;
  const stepDur = 60 / track.bpm / 2;

  const bassFreq =
  track.bass[Math.floor(radioStep / 2) % track.bass.length];

  const bassOsc = ctx.createOscillator();
  const bassFilter = ctx.createBiquadFilter();
  const bassGain = ctx.createGain();

  bassOsc.type = "sawtooth";
  bassOsc.frequency.setValueAtTime(bassFreq, now);
  bassFilter.type = "lowpass";
  bassFilter.frequency.setValueAtTime(260, now);
  bassGain.gain.setValueAtTime(0.18 * radioVolume, now);
  bassGain.gain.exponentialRampToValueAtTime(
    0.001,
    now + stepDur * 0.9
  );

  bassOsc.connect(bassFilter).connect(bassGain).connect(ctx.destination);
  bassOsc.start(now);
  bassOsc.stop(now + stepDur);

  const arpFreq = track.arp[radioStep % track.arp.length];
  const arpOsc = ctx.createOscillator();
  const arpGain = ctx.createGain();

  arpOsc.type = "triangle";
  arpOsc.frequency.setValueAtTime(arpFreq, now);
  arpGain.gain.setValueAtTime(0.09 * radioVolume, now);
  arpGain.gain.exponentialRampToValueAtTime(
    0.001,
    now + stepDur * 0.85
  );

  arpOsc.connect(arpGain).connect(ctx.destination);
  arpOsc.start(now);
  arpOsc.stop(now + stepDur);

  radioStep++;
}

function startRadioPlayback() {
  stopRadioPlayback();

  const track = RADIO_TRACKS[currentTrackIndex];

  if (track.url) {
    htmlAudio.src = track.url;
    htmlAudio.volume = radioVolume;
    htmlAudio.play().catch(console.warn);
  } else {
    const stepMs = (60 / track.bpm / 2) * 1000;
    playSynthStep();
    radioInterval = setInterval(playSynthStep, stepMs);
  }
}

function stopRadioPlayback() {
  if (radioInterval) {
    clearInterval(radioInterval);
    radioInterval = null;
  }

  htmlAudio.pause();
}

function toggleRadio() {
  radioPlaying = !radioPlaying;

  if (radioPlaying) {
    startRadioPlayback();
  } else {
    stopRadioPlayback();
  }

  updateRadioUI();
}

function changeTrack(delta) {
  currentTrackIndex =
  (currentTrackIndex + delta + RADIO_TRACKS.length) %
  RADIO_TRACKS.length;

  radioStep = 0;

  if (radioPlaying) startRadioPlayback();
  updateRadioUI();
}

$("playBtn")?.addEventListener("click", toggleRadio);
$("prevBtn")?.addEventListener("click", () => changeTrack(-1));
$("nextBtn")?.addEventListener("click", () => changeTrack(1));

$("volumeSlider")?.addEventListener("input", (event) => {
  radioVolume = Number(event.target.value) / 100;
  htmlAudio.volume = radioVolume;
});

updateRadioUI();

// ---------- Input Handling ----------
const keys = new Set();
const ui = { turbo: false, drift: false };

addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();

  if (
    ["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)
  ) {
    event.preventDefault();
  }

  if (key === "c" && !event.repeat) toggleCameraMode();
  if (key === "r" && !event.repeat) toggleRadio();
  if (key === "[" && !event.repeat) changeTrack(-1);
  if (key === "]" && !event.repeat) changeTrack(1);

  keys.add(key);
  startAudio();
});

addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
addEventListener("blur", () => keys.clear());
addEventListener("pointerdown", startAudio);

const down = (...values) => values.some((key) => keys.has(key));

for (const [id, key] of [
  ["turboBtn", "turbo"],
  ["driftBtn", "drift"]
]) {
  const button = $(id);
  if (!button) continue;

  button.addEventListener("pointerdown", (event) => {
    ui[key] = true;
    button.classList.add("on");
    button.setPointerCapture(event.pointerId);
  });

  for (const eventName of ["pointerup", "pointercancel"]) {
    button.addEventListener(eventName, () => {
      ui[key] = false;
      button.classList.remove("on");
    });
  }
}

$("camBtn")?.addEventListener("click", toggleCameraMode);

// ---------- Physics & Animation ----------
const clock = new THREE.Clock();
const tmp = new THREE.Vector3();

function step(dt) {
  const wantGas = down("arrowup", "w");
  const wantBrake = down("arrowdown", "s");
  const hand = down(" ") || ui.drift;
  const boosting =
  (down("shift", "n") || ui.turbo) &&
  nitro > 0.02 &&
  wantGas;

  throttle +=
  ((wantGas ? 1 : 0) - throttle) *
  Math.min(1, (wantGas ? 5 : 9) * dt);

  nitro = clamp(
    nitro + (boosting ? -0.22 : 0.05) * dt,
                0,
                1
  );

  const wheelRpm = ((speedMs / WHEEL_R) * 60) / (2 * Math.PI);
  const ratio = RATIOS[gear] * FINAL;
  const driven = wheelRpm * ratio;

  if (shiftTimer > 0) shiftTimer -= dt;

  const target =
  speedMs < 4
  ? IDLE + throttle * 3200
  : Math.max(IDLE, driven);

  rpm = damp(rpm, target, shiftTimer > 0 ? 7 : 14, dt);

  if (shiftTimer <= 0) {
    if (
      rpm > REDLINE - 350 &&
      gear < RATIOS.length - 1 &&
      throttle > 0.3
    ) {
      gear++;
      shiftTimer = 0.22;
    } else if (
      gear > 0 &&
      driven < (throttle > 0.85 ? 3400 : 1800) &&
      speedMs > 3
    ) {
      gear--;
      shiftTimer = 0.18;
    } else if (speedMs < 2.5) {
      gear = 0;
    }
  }

  rpm = clamp(rpm, IDLE, REDLINE);

  let Fd =
  shiftTimer > 0
  ? 0
  : (torque(rpm) * throttle *
  (boosting ? 1.35 : 1) * ratio * 0.9) / WHEEL_R;

  Fd = Math.min(Fd, MASS * (hand ? 4 : 8.6));

  const onGrass = Math.abs(rig.position.x) > 6.4;
  const Fdrag = 0.75 * speedMs * speedMs;
  const Froll = (onGrass ? 0.1 : 0.015) * MASS * G;
  const Fbrake =
  (wantBrake ? 11 : hand ? 4 : 0) *
  MASS *
  (speedMs > 0.3 ? 1 : 0);

  const Fnet =
  Fd - Fdrag - (speedMs > 0.1 ? Froll : 0) - Fbrake;

  aLong = Fnet / MASS;
  speedMs = Math.max(0, speedMs + aLong * dt);

  if (!wantGas && !wantBrake && speedMs < 0.3) {
    speedMs = 0;
  }

  const dir =
  (down("arrowright", "d") ? 1 : 0) -
  (down("arrowleft", "a") ? 1 : 0);

  steerIn = dir
  ? clamp(steerIn + dir * 2.6 * dt, -1, 1)
  : damp(steerIn, 0, 5, dt);

  const lock = 0.55 / (1 + (speedMs / 11) ** 1.3);
  const drifting = hand && speedMs > 8;

  let yaw =
  (speedMs / WHEELBASE) *
  Math.tan(steerIn * lock) *
  (drifting ? 1.5 : 1);

  const gripA = drifting ? 4 : 9.5;

  if (!drifting && speedMs > 1) {
    yaw = clamp(yaw, -gripA / speedMs, gripA / speedMs);
  }

  yaw = clamp(yaw, -1.8, 1.8);

  if (drifting && throttle > 0.3) {
    yaw += steerIn * throttle * 0.5;
  }

  yawRate = damp(yawRate, yaw, 10, dt);
  psi = clamp(psi + yawRate * dt, -1.25, 1.25);

  if (!dir && !drifting) {
    psi = damp(psi, 0, 0.5, dt);
  }

  latV = damp(latV, 0, drifting ? 1.1 : 7, dt);

  if (drifting) {
    latV += -yawRate * speedMs * 0.035;
  }

  aLat = speedMs * yawRate;

  const along = speedMs * Math.cos(psi) - latV * Math.sin(psi);
  const across = speedMs * Math.sin(psi) + latV * Math.cos(psi);

  rig.position.z -= along * dt;
  rig.position.x += across * dt;
  rig.rotation.y = -psi - latV * 0.02;

  const mapHalf = MAP_CONFIG.sizeMeters / 2;

  if (
    mapReady &&
    (
      Math.abs(rig.position.x) > mapHalf ||
      Math.abs(rig.position.z) > mapHalf
    )
  ) {
    rig.position.x = clamp(rig.position.x, -mapHalf, mapHalf);
    rig.position.z = clamp(rig.position.z, -mapHalf, mapHalf);
    speedMs *= 1 - 1.2 * dt;
    shake = Math.max(shake, 0.25);
  }

  shake = damp(shake, 0, 3, dt);

  const tt = performance.now() / 1000;
  const vib =
  (0.0006 + 0.0004 * throttle) *
  (rpm / 3000) * Math.sin((tt * rpm) / 9) +
  (onGrass ? 0.004 : 0.0008 * Math.min(1, speedMs / 20)) *
  Math.sin(tt * 37);

  const pitch = clamp(aLong * 0.0042, -0.05, 0.04);
  const roll = clamp(aLat * 0.0032, -0.07, 0.07);

  carRoot.rotation.x = damp(carRoot.rotation.x, pitch, 5, dt);
  carRoot.rotation.z = damp(carRoot.rotation.z, roll, 4, dt);
  carRoot.position.y = vib * 1.5;

  wheelSpinAngle -= (speedMs / WHEEL_R) * dt;

  const frontWheelSteer = -steerIn * lock;

  if (carParts.frontLeftWheel) {
    carParts.frontLeftWheel.rotation.y = frontWheelSteer;
  }

  if (carParts.frontRightWheel) {
    carParts.frontRightWheel.rotation.y = frontWheelSteer;
  }

  for (const rearWheel of carParts.rearWheels) {
    rearWheel.rotation.x = wheelSpinAngle;
  }

  if (carParts.steeringWheel) {
    carParts.steeringWheel.rotation[MODEL_CONFIG.gltfSteerAxis] =
    -steerIn * 2.4;
  }

  if (cameraMode === "cockpit") {
    const basePos = gltfLoaded ? MODEL_CONFIG.cockpitDriverPos : new THREE.Vector3(0, EYE, 0);
    camera.position.x = damp(camera.position.x, basePos.x - clamp(aLat * 0.006, -0.12, 0.12), 6, dt);
    camera.position.y = damp(camera.position.y, basePos.y + vib * 2 - pitch * 0.3, 8, dt);
    camera.position.z = damp(camera.position.z, basePos.z, 6, dt);

    camera.rotation.x = damp(camera.rotation.x, pitch, 5, dt) + vib + shake * 0.03 * Math.sin(tt * 50);
    camera.rotation.z = damp(camera.rotation.z, roll, 4, dt) + vib * 0.5;
    camera.rotation.y = damp(camera.rotation.y, -clamp(aLat * 0.0016, -0.04, 0.04), 3, dt);
  } else {
    camera.position.x = damp(camera.position.x, MODEL_CONFIG.chaseCamPos.x - steerIn * 0.45, 5, dt);
    camera.position.y = damp(camera.position.y, MODEL_CONFIG.chaseCamPos.y + vib, 5, dt);
    camera.position.z = damp(camera.position.z, MODEL_CONFIG.chaseCamPos.z + (boosting ? 0.6 : 0), 5, dt);
    camera.lookAt(rig.localToWorld(tmp.copy(MODEL_CONFIG.chaseLookTarget)));
  }

  fov = damp(fov, 75 + speedMs * 0.14 + (boosting ? 9 : 0), 4, dt);
  camera.fov = fov;
  camera.updateProjectionMatrix();

  // Fixed X-axis steering wheel rotation
  wheel.rotation.x = -steerIn * 2.4;
  dash.position.y = -vib * 3;
}

let mirrorFrame = 0;

function renderMirrors() {
  // Mirror rendering is paused in the OSM prototype to reduce GPU load.
}

const lockDeg = () => 30 * (1 / (1 + (speedMs / 11) ** 1.3)) * 1.8 + 4;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.04);
  step(dt);
  updateAudio();

  $("speed").textContent = String(Math.round(speedMs * 3.6)).padStart(3, "0");
  $("rpmText").textContent = Math.round(rpm / 10) * 10 + " RPM";
  $("rpmFill").style.width = (rpm / REDLINE) * 100 + "%";
  $("rpmFill").style.background = rpm > REDLINE - 600 ? "#ff3b3b" : "#20c8ff";
  $("gear").textContent = speedMs < 0.5 && throttle < 0.05 ? "N" : "D" + (gear + 1);
  $("steering").textContent = `STEERING: ${Math.round(steerIn * lockDeg())}°`;
  $("boostFill").style.width = nitro * 100 + "%";
  $("boostPercent").textContent = Math.round(nitro * 100) + "%";

  $("message").textContent =
  speedMs < 1
  ? "Engine idling · Press ↑ to accelerate · Press C for Chase Cam"
  : down(" ") || ui.drift
  ? "Handbrake · Counter-steer to hold the slide"
  : speedMs * 3.6 > 180
  ? "Very high speed · Keep control"
  : "Driving · Press C for Camera · Press R for Radio";

  renderMirrors();
  renderer.render(scene, camera);
}

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Keep the loading overlay visible until the OSM map request completes.
loadNairobiTestArea();

animate();
