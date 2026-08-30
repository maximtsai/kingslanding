# Architecture Guide

This document is written for AI coding agents working on the project. Read it before making changes, then inspect the relevant source files directly because this guide can become outdated.

## Project overview

This is a browser-based Three.js tower-defense game designed for mobile portrait play. The game uses a fixed-size 720×1280 stage scaled to fit the viewport. Gameplay is split between:

- **Simulation** in `src/sim/`: plain JavaScript state, rules, pathfinding, combat, waves, and phases.
- **Rendering** in `src/render/`: Three.js scene construction and render-only views.
- **UI/input** in `src/ui/` and `src/input/`: DOM HUD, gestures, and camera/build interactions.
- **Configuration** in `src/config.js`: tunable gameplay and presentation values.
- **Boot/orchestration** in `src/main.js`: creates the board, world, scene, views, HUD, and frame loop.
- **Presentation cross-cuts** in `src/feedback.js` (the only sanctioned consumer of simulation events) and `src/audio.js` (synthesized Web Audio, no asset files).
- **Shared geometry** in `src/stairs.js`: tile-space stair treads and heights used by both simulation elevation and rendering so a visible riser is also where a walker changes height.

The browser entry point is `index.html`, which imports `boot` from `src/main.js`.

## Important rules

1. **Simulation must not depend on Three.js, DOM, or audio.** Simulation records state and events; presentation consumes them.
2. **Rendering should read state, not mutate gameplay state.** Render views may maintain local visual animation state, but should not change simulation records.
3. **Put gameplay tunables in `src/config.js`.** Avoid scattering balance values through simulation code.
4. **Use existing helpers and conventions.** Before adding a library or abstraction, verify that the project does not already solve the problem.
5. **Prefer small focused edits.** The repository may contain unrelated local changes; do not overwrite or revert them.
6. **Preserve mobile usability.** The stage, HUD spacing, touch behavior, and readable text sizes are intentional.
7. **Keep simulation and rendering geometry synchronized.** Board heights, ramps, footprints, ranges, and collision rules often have corresponding render code.

## Runtime flow

`src/main.js` is the integration point:

1. Creates the board from the selected level.
2. Validates board and wave data.
3. Creates the simulation world.
4. Builds the static and dynamic Three.js scene.
5. Creates render views for units, structures, boats, projectiles, coins, hero, and placement ghosts.
6. Creates the feedback layer — the only consumer of emitted simulation events — and synthesized audio.
7. Creates the HUD and input handlers.
8. Runs the fixed-step simulation loop and interpolated render sync.

The simulation uses fixed time steps from `config.sim.HZ`. Rendering receives an interpolation alpha so moving objects can be drawn smoothly between simulation states.

## Simulation architecture

### `src/sim/world.js`

The central state owner and phase coordinator. Main phases are exported as `PHASE`:

- `INTRO`: arrival cutscene.
- `CASTLE`: mandatory castle placement.
- `BUILD`: place, upgrade, or sell defenses.
- `WAVE`: enemies and combat are active.
- `LOST` / `WON`: terminal states.

`world.step(dt)` advances the correct systems for the active phase. The world also exposes public operations such as `placeCastle`, `build`, `upgrade`, `sell`, `ready`, and restart functions. A build phase opens by settling the economy: surviving-house income is credited first and then the structures are repaired, so a house keeps its ruined shell through the wave and reverts only after the pay-out.

### `src/sim/board.js`

Single source of truth for terrain data and spatial rules. It handles:

- Tile heights and land/water checks.
- World-coordinate conversion.
- Terrain surface heights.
- Ramps/stairs and stair elevation.
- Walkability and step rules.
- Board validation.

Use board helpers instead of recomputing tile/world coordinates elsewhere.

### `src/sim/structures.js`

Owns houses, towers, and the castle. It manages occupancy, footprints, placement validation, upgrades, destruction, repair, and selling. Structures are plain records with fields such as `i`, `j`, `x`, `z`, `span`, `halfExtent`, `hp`, and `alive`.

The castle is a 2×2 permanent objective. Houses are authored scenery/gameplay structures. Towers are purchased and upgraded during build phases. A dead house keeps its tile occupied and renders as a ruin (`house:ruined` visual) until repaired at the start of the next build phase — do not recycle its plot while it is dead.

### `src/sim/hero.js`

Owns the king’s movement, pathing requests, cliff jumps, attacks, damage, death/revival, and home position. The hero has special pathing rules: he can descend cliffs, while normal enemies cannot. Keep hero-specific collision behavior separate from enemy behavior.

### `src/sim/enemies.js`

Owns enemy spawning records, enemy targeting, aggression, movement, melee/ranged attacks, boat passengers after spawning, and hero retaliation behavior. Enemy types are configured in `config.enemies`.

### `src/sim/waves.js`

Owns boats and wave timing. It resolves landings, spawns boats, places passengers aboard, handles disembarkation, and reports wave completion. Each boat should carry no more than eight units. If wave definitions are edited, preserve this invariant directly in `config.js` rather than relying only on runtime splitting.

### `src/sim/combat.js`

Central projectile and targeting system. All ranged targeting should pass through `canHit`, which accounts for range, minimum range, elevation, and line of sight. Projectiles move through states such as flying, grounded, embedded, miss, overtravel, and submerged. Shots do not home: each projectile bakes its aim point (including lead prediction) at launch and flies along the stored direction, so grounded and embedded arrows can keep facing their original target.

### Other simulation modules

- `flow.js`: flow fields/pathfinding.
- `angles.js`: wrap-safe facing and gait interpolation, imported by the renderer so units never spin the long way around.
- `separation.js`: unit spacing and knockback.
- `coins.js`: coin drops, pickup, magnetism, and wave-clear sweep.
- `intro.js`: level-one king-and-boat arrival cutscene.
- `landing.js`: authored/resolved boat landing points.
- `levels.js`: level maps, ramps, houses, decorative reservations, and intro data.
- `los.js`: line-of-sight trajectories and elevation-aware projectile math.
- `loop.js`: fixed timestep loop.

## Rendering architecture

### Static vs dynamic scene roots

`src/render/scene.js` creates:

- `staticRoot`: terrain, water, nature, decor, and batched scenery.
- `dynamicRoot`: units, hero, boats, projectiles, coins, structures, and placement previews.

Static content is passed through `batchStatic`. Do not put objects that need per-frame changes into the static batch.

### Render views

`src/render/views.js` holds most of the dynamic views; the enemy/unit view lives in `units.js` (`createUnitView`). Together they cover:

- Structure instances and construction effects.
- Boat hulls, intro departure animation, bubbles, and an instanced pulsing wake shared by every boat — one `InstancedMesh`, with each boat's matrix carrying its own pulse phase.
- Projectiles and impact ripples.
- Coins.
- King hero and destination marker.
- Building placement coverage and footprint ghost.

Views generally expose `sync(...)`, which reads simulation records and updates Three.js objects. Use pooled objects for frequent effects instead of allocating every frame.

### Render-only builders

- `structures.js`: castle, house, ruined-house, and tower prefabs.
- `rigs.js`: enemy unit rigs and weapons.
- `king.js`: king rig.
- `units.js`: enemy animation and unit view.
- `nature.js`: trees, bushes, flowers, and terrain vegetation.
- `terrain.js`: terrain mesh and grid.
- `water.js`: water plane and shoreline.
- `decor.js`: static banners and decorative marks.
- `kit.js`: shared materials, geometry helpers, and sprite textures.
- `palette.js`: the single source of scene colours — change the look here, not inside the builders.
- `picking.js`: analytic tile picking. The batched terrain has no per-tile identity, so a raycast cannot name a tile; this module marches the camera ray against the height grid instead.
- `util.js`: pure helpers (seeded PRNG, planar geometry, GPU capability probe) with no scene-graph side effects.
- `flatten.js` / `batch.js`: geometry flattening and static batching.
- `renderer.js`: camera, lighting, post-processing/grade, and render loop support. The follow camera eases its vertical target separately (`FOLLOW_Y_LAG`) so stair climbs stay smooth without the X/Z follow fighting the sudden height change.

For performance, prefer shared geometry/materials, instancing, fixed pools, and simple shader uniforms over per-frame geometry rebuilding.

## UI and input

### `src/ui/hud.js`

Builds and updates DOM controls. It manages:

- Build and upgrade panels.
- Castle siting.
- Placement proposal and confirmation.
- Incoming-wave preview badges.
- Camera controls and options.
- Wave-start announcements.
- Game-over/restart controls.

The placement flow is intentionally three-stage: select a building, propose a tile, then confirm. Keep invalid placement feedback visible without allowing confirmation.

### `src/input/gestures.js`

Normalizes pointer/touch gestures. The established movement behavior is tap-to-move on release, with dragging reserved for camera rotation. Avoid changing down/up semantics without checking the complete input flow through `main.js`, HUD placement, and `world.moveHero`.

### `index.html`

Contains the mobile HUD markup and CSS. Keep small text readable on mobile. The fixed stage coordinate system is 720×1280; HUD positions and projection helpers use that coordinate space. A `#loading` overlay is hidden once the first frame is ready — style overlay/loading content here rather than in view code.

## Data and balance

`src/config.js` contains camera, simulation, board, tower, enemy, wave, economy, intro, combat, and rendering-related tunables. Current notable invariants include:

- Level one has one wave consisting of two groups of four grunts.
- Each boat should carry at most eight units.
- The castle is free and mandatory.
- Archer Tower costs 20 gold.
- Barricade costs 15 gold.
- Starting gold is 25.
- The intro boat carries the king and later retreats/submerges visually.

When changing a value, search for comments or dependent logic that describe the old behavior and update them if they become misleading.

## Validation workflow

After non-trivial changes:

1. Run `node --check` on every changed JavaScript file.
2. Run the project’s relevant test/build/typecheck command if one exists.
3. Use `git diff --check` and inspect only the focused diff. CRLF files may produce existing trailing-whitespace warnings; distinguish those from newly introduced formatting problems.
4. For visual changes, run the game and inspect both desktop and mobile-sized layouts when possible.
5. Do not commit, push, deploy, or broadly stage changes unless explicitly requested.

## Guidance for future AI agents

- Inspect current files before assuming historical behavior; multiple agents may have edited the same checkout.
- Search narrowly first, then read a surrounding window rather than dumping very large files.
- When a request names a visual element, determine whether it is DOM UI, a dynamic Three.js object, or batched static geometry before editing.
- For behavior bugs, identify the authoritative owner of the state and check for multiple systems writing the same fields.
- Keep changes reversible and avoid unrelated cleanup.
- If a request is ambiguous and the choice affects gameplay balance or architecture, ask a focused question rather than guessing.
