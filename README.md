# HOOD

**A browser-based 3D driving simulator built with Three.js and JavaScript.**

I'm at building experimental driving game focused on real-time 3D rendering, custom vehicle physics, road-network generation, environmental reconstruction, and interactive driving systems. The project aims to build a scalable, open-world driving experience based on Nairobi's roads and neighbourhoods, with support for multiple vehicles, different driving modes, and controller-based input.

The long-term goal is to evolve HOOD into a detailed neighbourhood-scale driving simulator with a modular vehicle system, configurable environments, multiplayer capabilities, and eventual VR support.

## Tech Stack

| Technology              | Purpose                                        |
| ----------------------- | ---------------------------------------------- |
| JavaScript (ES Modules) | Core game logic and modular architecture       |
| Three.js                | Real-time 3D rendering and scene management    |
| HTML5                   | Game interface and UI structure                |
| CSS3                    | HUD, menus, overlays, and responsive layouts   |
| WebGL                   | Browser-based hardware-accelerated graphics    |
| GLTF / GLB              | 3D vehicle and environment assets              |
| GLTF Transform          | 3D asset optimization and processing           |
| Meshoptimizer           | Mesh compression and optimization              |
| OpenStreetMap (OSM)     | Road-network and geographic data               |
| JSON                    | Configuration, route data, and game metadata   |
| GitHub                  | Source control, versioning, and issue tracking |
| Vercel                  | Web deployment and preview builds              |

The project currently uses a custom JavaScript vehicle simulation rather than relying on a dedicated physics engine.

## Core Systems

### 1. Rendering Engine

* Three.js scene, camera, lighting, and renderer initialization.
* Modular loading of game assets and environment components.
* Real-time rendering of vehicles, roads, and surrounding environments.
* Performance-oriented asset loading and optimization.

### 2. Vehicle Simulation

* Custom vehicle dynamics and driving behaviour.
* Acceleration, braking, steering, and speed calculations.
* Drifting and turbo/nitro mechanics.
* Automatic transmission behaviour and configurable drivetrain parameters.
* Reusable vehicle logic intended to support multiple car models.

### 3. Vehicle Selection

* Selectable vehicles with separate 3D models and configurations.
* Current vehicle lineup includes the Dodge Challenger R/T and Subaru WRX STI.
* Shared driving logic designed to reduce duplication when adding vehicles.

### 4. Road and World Systems

* Road-network integration using geographic data.
* Route-based road generation and rendering.
* Support for tarmac and murram road surfaces.
* Road markings and route-specific environment configuration.
* Initial Nairobi routes, including the State House Avenue area and connections toward Nairobi Gallery.

### 5. Camera System

* Third-person chase camera.
* Cockpit camera.
* Cinematic front/side tracking camera development.
* Camera switching without resetting the current driving session.

### 6. Input and Controls

* Keyboard-based driving controls.
* Dedicated controls for drifting and turbo.
* Planned support for Xbox, PlayStation, and generic game controllers.
* Future input abstraction to support additional control devices.

### 7. Game Flow and Interface

* Startup splash screen and initialization flow.
* Engine readiness and session-start coordination.
* Vehicle, route, and game-mode selection.
* Free Drive and Race mode foundations.
* Driving HUD and in-game controls.

### 8. HOOD Radio

* In-game music playback.
* Track catalogue and playlist interface.
* Background music preloading and playback handling.
* Radio interface designed to operate independently of the driving simulation.

## Project Architecture

The codebase is organized around ES modules, with rendering, vehicle simulation, world construction, input, and interface systems separated into individual responsibilities.

```text
Anemoia/
├── index.html
├── src/
│   ├── main.js
│   ├── car/
│   │   ├── vehicle.js
│   │   └── carRig.js
│   ├── world/
│   │   └── staticWorld.js
│   ├── input/
│   ├── rendering/
│   └── ...
├── models/
│   ├── dodge.glb
│   └── ...
├── source/
│   └── dodge/
├── music/
├── assets/
├── tests/
└── README.md
```

*Illustrative structure: directory names may differ between development versions.*

The intended architectural direction is to keep vehicle physics independent of rendering, vehicle models separate from handling configurations, and world generation independent of the core driving loop.

## Development Priorities

* [ ] Stabilize the initialization and driving-session lifecycle.
* [ ] Complete road geometry, markings, and surface rendering.
* [ ] Improve route selection and route loading.
* [ ] Refine vehicle handling, suspension behaviour, and collision response.
* [ ] Standardize vehicle configuration and registration.
* [ ] Expand controller support and input mapping.
* [ ] Improve rendering performance and asset-loading efficiency.
* [ ] Develop race logic, checkpoints, and timing systems.
* [ ] Add richer Nairobi buildings, landmarks, and neighbourhood environments.
* [ ] Introduce persistent player settings and progression.
* [ ] Explore multiplayer networking and synchronized driving sessions.
* [ ] Investigate VR support and external display integration.

## Running Locally

The project uses browser-based JavaScript modules and locally served assets. Run it through a local web server rather than opening `index.html` directly, so module imports and asset requests resolve correctly.

For example, with PHP installed:

```bash
cd /path/to/Anemoia
php -S localhost:8000
```

Then open:

```text
http://localhost:8000
```

Run the server from the directory containing the version's `index.html`. If a version uses a different entry point or dependency configuration, follow that version's setup.

## Development Approach

The project prioritizes modular code, reusable simulation systems, optimized assets, and incremental releases. New features should integrate with the existing architecture rather than introduce unnecessary duplication or tightly couple the vehicle simulation to the rendering and UI layers.

## Status

HOOD is under active development. Rendering, vehicle simulation, selectable vehicles, driving interfaces, and supporting systems are being developed iteratively. Road integration, environment fidelity, physics refinement, and broader gameplay systems remain ongoing work.

## License

License and third-party asset terms will be documented as the project and its dependencies are finalized.
