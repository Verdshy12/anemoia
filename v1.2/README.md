# Nairobi Driving Sim — v1.2

Drive a Dodge Challenger around real Nairobi streets and buildings (OpenStreetMap), starting on State House Avenue.

## Run it (no install needed)
You only need a browser and any static web server (browsers block loading models from `file://`).

    cd v1.2
    python3 -m http.server 8080        # or: npx serve .
    # open http://localhost:8080
    # add ?debug for the performance overlay: http://localhost:8080/?debug

Everything the game needs (Three.js, the optimized car, the map tile) is already included. No internet needed.

## Controls
W / Up = throttle · S / Down = brake, hold to reverse · A D / Left Right = steer · Space = handbrake (drift)
Shift or N = nitro · C = camera (chase / cockpit) · R = radio · [ ] = tracks · gamepad supported (untested)

## What changed from v1.1
- Car: 1,417 draw calls / 18.7 MB  ->  23 draw calls / 3.6 MB. Wheels now spin and steer correctly.
- Map: no more 14 MB JSON at start; a 93 KB pre-built tile (243 roads, 478 buildings, 1.2 km square).
- Physics: rewritten (free heading, drifting, reverse, road vs grass grip, building collisions). Fixed 120 Hz timestep.
- Stability: adaptive resolution, GPU context-loss recovery, `?debug` overlay, no CDN.
- Code split into modules (see src/). Physics and world code have no browser dependencies, so they are unit-tested.

## Tuning the handling (arcade, NFS-style)
Open `src/car/vehicle.js`, top of the file, `CAR`: `grip` (tyre grip multiplier), `steerLock`, `drag` (top speed), `mass`.
Then run `npm test` — it tells you if you broke braking, drifting, reverse or stability.

## Developer setup (only for tests and rebuilding assets)
    npm install
    npm test                # 6 test files: physics, world, geometry, real car rig, autopilot drive
    npm run vendor          # re-copy Three.js into ./vendor

Rebuild assets from the originals (copy them into ./source first):
    source/dodge/scene.gltf (+ scene.bin, textures/)   ->  npm run build:car     -> models/dodge.glb
    source/nairobi-osm.json                            ->  npm run build:tile    -> data/tiles/state-house.json
Change the area: `node tools/build-tile.mjs source/nairobi-osm.json data/tiles/NAME.json --lat <lat> --lon <lon> --radius 600 --spawn "Road Name"`
and point `map.tile` in `src/config.js` at it.

Browser end-to-end test (optional): `pip install playwright && playwright install chromium`, start the server, run `python3 tests/e2e.py http://localhost:8080`.

## Known limits
- Not tested on a real GPU, audio, or gamepad by the author (see the plan document).
- Terrain is flat; untagged building heights are guesses; OSM multipolygon buildings are not included yet.
- Paint looks very dark (no environment map yet) — planned for M3.
- Optional `source/` folder is empty on purpose.

## Layout
    index.html, style.css      page + HUD
    src/config.js              all tunables
    src/main.js                wiring
    src/car/                   vehicle.js (physics), carRig.js (model + wheels)
    src/world/                 staticWorld.js (roads/collision), meshes.js (geometry)
    src/core/                  loop, quality, renderer, input
    src/audio/audio.js         engine + radio (moved from v1)
    tools/                     optimize-car, build-tile, vendor-three
    tests/                     unit + end-to-end tests
