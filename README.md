# Material Synergy Engine

A reusable 2D material engine with a Particle Lab test harness built with Phaser, TypeScript, and Vite. Paint 19 materials and explore qualitative reactions: lava ignites wood and oil, water cools lava into stone and steam, heat melts ice and turns sand into glass, salt dissolves into water, and acid erodes exposed solids.

## Engine configuration

Games import `Simulation` and config types from `src/engine/index.ts`. The core has no Phaser, DOM, demo scenes, default material IDs, or built-in material names. Particle Lab definitions and reaction data live in `src/demo/materials.ts`; presets live in `src/demo/scenes.ts`. `src/simulation.ts` is the lab's compatibility adapter.

Each world supplies material definitions and an ordered reaction list. String keys resolve to runtime IDs when the world is constructed. Slot zero is the sole empty-space sentinel; other IDs are assigned by config order. Use `sim.materialId(key)` rather than fixed numeric IDs. The registry supports up to 256 definitions including empty space.

```ts
import { Simulation, type WorldConfig } from './src/engine';

const config: WorldConfig = {
  materials: [
    { key: 'void', name: 'Void', state: 'Empty', density: 0,
      thermal: { initialTemperature: 0, capacity: 1, conductivity: 0, airTransfer: 0 } },
    { key: 'resin', name: 'Resin', state: 'Solid', density: 900,
      thermal: { initialTemperature: 0, capacity: 2, conductivity: .02, airTransfer: .16 } },
    { key: 'solvent', name: 'Solvent', state: 'Liquid', density: 1100,
      thermal: { initialTemperature: 0, capacity: 1, conductivity: .12, airTransfer: .16 } },
  ],
  reactions: [{
    inputs: { self: ['solvent'], neighbor: ['resin'] },
    conditions: { minTemperature: 0 },
    outputs: [{ target: 'neighbor', material: 'void' }, { target: 'self', material: 'void' }],
    counter: 'dissolved', stop: true,
  }],
};
const sim = new Simulation(config, 240, 144, 42);
sim.set(10, 143, sim.materialId('resin'));
sim.set(11, 143, sim.materialId('solvent'));
sim.step();
```

Thermal config declares initial temperature, sustained source status, heat capacity, conductivity, exposed-air transfer, and optional phase-change point, heat budget, output and counter. Flammability declares the contact-combustion output; rules can select `{ flammable: true }` neighbors and emit `$flammability`. An optional `heatIgnition` definition adds a temperature point, required consecutive simulation ticks above that point, output, and counter. It works without contact with a heat source and resets its exposure when the material cools.

Failure config declares impact speed thresholds and stress compression/bending strengths, evaluation interval, section sampling radius, minimum body size, fracture budget, output and counter. Lifetimes, emissions, motion cadence and vapor drift are also data. Omitted behaviors are inactive. No callbacks or executable config are required.

Reactions examine neighbors left, right, above, below. Rules run in declaration order for each matching pair. Conditions check the actor's temperature and optional seeded probability; outputs apply in order. `empty-neighbor` selects the first currently empty neighbor of the actor, skipping that output when none exists. `stop` ends the actor's reaction processing for that tick. Solid actors can react too. Invalid references and numeric limits fail during construction.

The constructor copies and freezes definitions/rules so editing source config cannot alter a running simulation. A seed plus identical config, ordered inputs and tick count produces identical output. Rendering consumes no simulation randomness. Compatibility fixtures captured before this migration compare exact particles, lifetimes, temperatures, UVs, counters and RNG state with the new heat-ignition option disabled. Config tests define new materials and reorder the lab registry to prove behavior does not depend on built-in IDs. Replay serialization and event subscriptions remain future work; counters are the current observation API.

The workspace uses a 960×576 particle grid, with one particle per native canvas pixel. Fullscreen expands the whole lab, keeping material selection, brush controls, and playback controls available. Escape exits the expanded view; browsers that allow native fullscreen also hide browser chrome.

At 1× speed the simulation targets 60 fixed updates per second, independently of the rendering FPS counter. Slow frames have a bounded catch-up budget to avoid freezing the interface. Steam uses translucent, soft vapor rendering with irregular buoyant drift. Particle lifetimes are scaled for the 60 Hz simulation.

## Material rendering

The separate renderer in `src/rendering.ts` adds seamless procedural wood grain, mineral facets, ice veins, granular powders, and molten lava textures. Edge highlights and contact shadows suggest depth. Liquid surfaces reflect light and darken with depth; water, ice, and glass blend with the background for a translucent appearance. Lava and fire generate a soft warm light field. Steam and smoke use soft density layers.

Texture coordinates travel with particles, so grain follows falling and broken pieces. Textures and the background are cached; hot-material lighting is diffused at one-eighth resolution, and unlit empty areas skip shading work. These are artistic 2D approximations, not ray-traced shadows, 3D geometry, or physically accurate refraction.

## Connected solids

Wood, ice, stone, glass, concrete, and grass cells of the same material bond along shared edges. Unsupported pieces fall together. Solids displace liquids and gases without deleting them. Painting, erosion, burning, and melting update the connected pieces; disconnected fragments fall independently. Touching pieces of the same material join together. Concrete is dense and nonflammable; grass is a light combustible solid with no automatic growth. Acid erodes both.

Acid is a simplified game material: one acid cell consumes one exposed wood or stone cell, or melts one ice cell, then is spent. Glass resists this acid. Try **Break a beam** to see acid cut off the unsupported end of a wooden beam. Pause while building, then play to apply gravity. There are no fixed building materials.

Solid motion has vertical acceleration, collisions, density-based buoyancy, and rotation. Overhanging pieces tip when their centre of mass lies outside the supporting footprint. Uneven buoyancy rotates floating pieces; slender upright floating shapes receive one tiny perturbation to escape perfect grid symmetry. Try **Tip a beam**.

Rigid poses retain floating-point cell coordinates while rotating. Rasterization assigns unique nearby voxels to preserve particle count, temperature, and texture coordinates. Outlines change slightly from voxel rounding. This is an approximate torque/collision solver, without full horizontal dynamics, friction, or a general contact-impulse solver.

Concrete has authored compression and bending strengths. A support-path model distributes weight toward supporting cells; narrow sections accumulate stress, while thicker sections resist bending. Overloaded cells become equal-density rubble, allowing disconnected chunks to fall. Try **Concrete stress**. The model is not an elastic structural solver or an engineering safety tool; carried loads are approximated and strength depends on voxel scale.

Glass shatters into equal-density loose shards when its downward relative impact speed reaches 1.1 cells/tick against stone, concrete, glass, or the floor. Glass-on-glass impacts are detected before touching pieces can bond; both pieces can shatter. Gentle landings and water-slowed sinking leave glass intact. Wood is treated as a cushioned surface. Try **Shatter glass**. Debris preserves cell count and model mass, without a full impact-energy or crack-propagation solver.

## Heat transfer

Lava and fire heat a separate coarse field that spreads and fades through nearby space. Particles carry temperature as they move. Adjacent matter conducts heat; exposed surfaces exchange heat with the surrounding field. Wood conducts more slowly than mineral materials, and water has a higher heat capacity. Ice starts at -10 model degrees, warms toward 0, then absorbs a finite melting-heat budget before changing into water. Dry-grass-like lab material ignites after 18 ticks above approximately 550 °F; wood requires 45 ticks above approximately 650 °F. Direct-contact reactions remain immediate.

Try **Heat across a gap**: glass walls keep lava away from the ice. The nearby block melts from its exposed edges while the distant block stays cold. Try **Ignite across a gap** to compare grass and wood heated without contact. Point the brush at air or matter to inspect temperature. Clear resets particles, temperature, and residual heat.

Thermal updates run at 20 Hz alongside 60 Hz particle motion, using an 8-pixel field with diffusion/cooling. Particle Lab displays temperatures in Fahrenheit; internal values remain on the original Celsius-like model scale so existing reaction thresholds and replays are unchanged. Capacities and phase-change heat are authored game parameters. Ambient is fixed at 0 model degrees (shown as 32 °F), lava/fire act as sustained heat sources, and material heating currently adds non-contact ice melting. Heat does not model physical radiation occlusion, convection, calibrated conduction, or energy conservation.

## Density and mass

Every material has a representative model density. Each equal-volume cell has mass `density / 1000` in model units: one water cell equals 1 u. Connected solid mass is the sum of its cells, and changes when cells are added, erased, burned, melted, or eroded. The inspector shows density, mass per cell, and the mass of the solid under the brush. Try **Sink or float** to compare wood, ice, and glass in water.

Heavier liquids settle beneath lighter liquids. Wood and ice float partially submerged; stone and glass sink. All solid masses share the same free-fall acceleration. Displaced-liquid mass provides buoyancy, fluid drag slows motion, and supported cargo contributes to a piece's load. Small loads can rise with a wooden raft; sufficiently heavy loads sink it. Body weight and downward momentum determine whether a piece can nudge loose powder sideways. Collision and movement preserve particle counts; cleared scenes reset momentum.

Density values are nominal game parameters rather than temperature-dependent measurements. Buoyancy estimates immersion from fluid alongside solid row segments; load sharing and powder resistance are approximations. There is no physical length scale, kilogram mass, full pressure solver, or general rigid-body dynamics. Chemical reactions and phase changes still replace fixed-volume cells and do not conserve physical mass.

## Run

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Drag to paint; right-click or choose Erase to remove particles. Scroll the mouse wheel over the workspace to zoom toward the pointer, from 100% to 800%. The percentage above the canvas resets the view to 100%. Zoom changes the view and brush targeting, not the simulation resolution. Space pauses, brackets change brush size, and F toggles fullscreen. Focus the workspace and use arrow keys to position the brush and Enter to paint. Painting also works with touch.

Use the example scenes or start with Blank canvas. Pause to build structures, then press Play. Step advances one simulation tick while paused. Clear removes all particles and reaction counters.

## Verify

```sh
npm run verify
```

Runs deterministic simulation tests, TypeScript checking, and the production build. The standalone library is in `src/engine/`; Phaser rendering, input, and HTML controls are in `src/main.ts` and `src/rendering.ts`.

## Scope

This is a game with simplified material rules, not a scientific chemistry simulator. Reactions combine adjacency, approximate thermal ice melting, and finite particle lifetimes, without oxygen, pressure, or energy conservation. Fire can rise away from fuel. No accounts, servers, paid APIs, or external persistence are used. Scenes are not saved across reloads. Fonts use Google Fonts with local fallbacks.
