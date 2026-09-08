# Build Log: King's Landing (Hero Tower Defense)

**Genre:** Tower Defense / Action Hybrid
**Platform:** Browser, mobile-first portrait (fixed 720×1280 stage, scaled to fit)
**Stack:** Three.js, vanilla ES modules, no build step, no asset files (audio is synthesized Web Audio)

**Pitch:** A king with a bow defends a small island from seaborne raiders. Towers do the bulk of the killing; you plug the holes. Boats approach visibly, so you get time to reposition before the wave lands.

---

## About this log

Generated retroactively by asking past sessions and exploring git commits.

---

# PART 1 — Decisions locked so far

### Concept
- King with a bow defends a small island from seaborne raiders. Towers kill most things; the hero plugs gaps.
- References: **Bad North** (island diorama, rotatable camera, boat telegraphing), **Thronefall** (build/combat phase loop, single controllable hero).
- Each level is standalone. **No meta-progression, no unlocks, no save system.**

### Core loop
```
Castle placement (mandatory 2×2, no wave can start until valid)
  → Build phase (untimed) — place/upgrade/sell towers, hero moves freely
  → player presses READY
  → Wave — boats spawn on open water, ~10s approach, enemies disembark when the boat lands and they path to the castle
  → Combat lasts until the last enemy dies. Enemies drop gold which automatically gets collected at the end.
  → back to Build
```
- **Wave counts as shipped: Level 1 = 4, Level 2 = 6, Level 3 = 6.**
- Towers are a **one-time capital purchase, never upkeep.** Between waves everything is repaired free *at its full upgrade tier* — if an upgraded tower came back as T1, upgrading would be a trap.
- Sell refunds 50% of **total invested** gold, not base cost.

### Controls
- Mobile-first portrait.
- Tap the ground = move the king. **A tap PROPOSES, it never buys** — with something armed, a tap picks the tile and a separate confirm button spends the gold.
- Castle siting is **armed, never automatic.**
- Camera: **orthographic**, 35° pitch, rotatable yaw, follows the king with exponential lag. Ortho is deliberate — a perspective swivel would shear the elevation tiers. Drag rotates 1:1 (a tween on a drag reads as input lag); buttons ease.

### Architecture (hard rules, from `architecture.md`)
1. **Simulation must not depend on Three.js, DOM, or audio.** Sim records state and events; presentation consumes them.
2. **Rendering reads state, never mutates gameplay state.**
3. **Gameplay tunables live in `src/config.js`.**
4. `src/feedback.js` is the **only** sanctioned consumer of simulation events.
5. `src/stairs.js` is shared by sim elevation and rendering, so a visible riser is where a walker changes height.
6. Fixed-step sim (`config.sim.HZ`) with an interpolation alpha handed to render.

### Art direction (the constraints that affect code)
The whole visual programme serves two goals: **run well on a mobile GPU, and stay legible at diorama scale.** Everything below follows from those.
- Low-poly flat-shaded, **no textures, no shadow maps, no cast shadows, no blur passes.** Grounding is a contact-occlusion sprite directly under each prop.
- Lighting is **ambient-dominant**. Consequence worth knowing before fighting it: the rig barely registers small surface tilts, so any relief the player should *see* must be written into vertex colour as well as geometry.
- **Animate size or width, never alpha.** Surf rings breathe their width; wave crests scale 0 → full → 0. Everything stays opaque.
- All colour lives in `src/render/palette.js`. **Saturated hues are reserved for the king and banners**; the environment is forbidden red.
- The water plane doubles as the sky — no skybox.
- The wave-phase evening tint is **hue only**, every light intensity unchanged: *"Change what colour the light is, not how much."*

### Performance model
- **The budget is draw calls and fill, not vertices.** `batch.js` collapses static scenery into merged buffers at boot; anything added after the freeze cannot be batched.
- `gpuTier()` gates pixel ratio (2 desktop / 1.5 mobile / 1 weak), MSAA, and whether decorative animation runs.
- One seeded PRNG generates the whole scene. **Inserting a draw from it shifts every random decision downstream**, so new systems must use their own stream.
- Corollary: the scene is deterministic, so **triangle count is a regression test**. A refactor that preserves RNG order reproduces the exact same total.

### Onboarding (level 1 only, `L1` in `hud.js`)
- **A gated sequence, not a script:** land → climb to tier 2 → destroy both training dummies → castle prompt → build one archer tower → wave 1. Each gate is a real game state, so a player doing it out of order still gets through.
- The castle prompt gates on `hero.tier >= 2 && allDummiesDestroyed()`. **Both halves must be re-checked every frame** — see Session 5, problem 2.
- **Training dummies are one-shot props** — explicitly exempt from the free between-waves `repairAll`.
- The barricade is withheld through wave 1 and revealed **by its own announcement**, so button and explanation arrive together.
- One-shot lessons share a single callout bubble and **queue**; anything gated behind a lesson must also run if the player skips it (`flushCallouts`).
- **Still untaught, and known:** tower upgrades / the radial menu (the largest gap — ten of twelve tower types live behind it), coin pickup, that the build phase is untimed, hero death and revive, cliff-jumping.

---

# PART 2 — Session log

## Session 1 — Diorama art pass, static batching, module split
**2026‑08‑29** (`8200bc3` "first") · *Game visual improvements, Bad North…* · **First-hand**

> **Correction.** Previously logged as reconstructed, crediting this session with the board/grid elevation tiers, the sim/render split and the first units. **That was wrong** — those exist but were not made here. This session was an art, performance and refactor pass on a standalone diorama artifact (`dio-*.js`).

**Repo note:** commit `8200bc3` bundles this session's twelve `dio-*.js` files with a full game that was *not* built here (58 files, 64k insertions, one message). The boundary is unrecoverable from git; **I can only vouch for the diorama files.** They were later ported into `src/render/*`, which is still today's layout — `batch.js` and `palette.js` still open with this session's header comments word for word.

**Built:** an art pass toward Bad North's readable low-poly look; **static batching, 582 draw calls → 20**; two new towers; board grown 8×8 → 10×10; **1,494-line monolith split into 12 files**.

**Key decisions:**
- **Spend the budget on draw calls, not vertices.** Batching beat any geometry reduction and set the performance model still in use.
- **Verify the refactor numerically.** The split version renders **34,970 triangles, identical to baseline** — far stronger evidence than "the screenshot looks the same".
- **No cast shadows**, treated as a hard constraint rather than something to design around. It has held all project.

**Biggest problems:**
1. **`MeshLambertMaterial` silently drops `flatShading` in three r128.** My batching predicate required it, selected **zero meshes**, and draw calls stayed at 582. The faceted look comes from `computeVertexNormals()` on non-indexed geometry, not the flag. Second-order damage: I nearly concluded the batcher didn't work. **A silently-ignored option is worse than a thrown error.**
2. **The cape was a flat ribbon, and the maths said so.** Reported as "looks stiff". Cause was one line — `z` had no `u` term, so every point at a given height sat at the same depth. No amount of fold detail fixes that.
3. **Line endings.** Patch scripts rewrote LF as CRLF, inflating one diff from ~40 to **2,263 lines**. *The same class of bug cost time again in Session 6.*

**Pivot:** took the palette fully desaturated, judged it too far, then lerped 50/50 back — which worked for solids and **failed completely on the sky gradient**, collapsing both ends to one tone. **"Interpolate halfway" is only meaningful when the endpoints are the same kind of thing.**

**Learned:** when a visual reads wrong, **find the equation before adjusting the art**. Verify a refactor with a number. And the constraint you just introduced becomes the one you fight next — fill-heavy lighting fixed the cliffs and immediately made surface relief invisible.

**Stood at:** 10×10 island, 20 draw calls, 60fps, ~35k triangles. No game yet — only a diorama.

---

## Sessions 2–4 — Spec, tooling, and visual polish
**~2026‑08‑30 → 09‑05** · *Hero-td-prototype-tdd game expansion* / *Level setup file storage* / *Game lighting and colors* · **Reconstructed, low confidence**

These three were exploration and polish passes aimed at the same two goals as the rest of the art programme — **mobile performance and legibility at diorama scale**. Kept brief deliberately: they are reconstructed from commits, and the durable output is better read in the code than described here.

**What landed, from the code evidence:**
- **The TDD** grew into the ~900-line spec, including load-time validation so `board.js` throws on a bad level rather than failing mid-wave.
- **Level authoring:** `src/sim/level-data.js` as the single source of level truth, `tools/level-editor.html`, and a write endpoint in `devserver.py` so the browser editor can save to disk. `devserver.py` also sets `no-store` on everything — a cached ES module survives a hard reload, which turns every edit into a guess about whether you're seeing your change.
- **Lighting and colour:** the ambient-dominant rig, the day→evening blend, the grade pass. Assorted rig and geometry fixes, including both bows being built ninety degrees wrong — two independent rigs sharing one mistake, which is **one wrong belief applied twice, not two bugs**.

**The one decision worth carrying forward** is the clearest recorded pivot in the repo. `config.js` documents that the first evening pass *"dimmed the key, lifted the vignette and pulled saturation down, and the result read as haze rather than as evening."* The fix holds every light intensity identical to daylight and moves only hue: *"That is not laziness, it is the whole fix."* The failure mode was *plausible* — dimming light to suggest dusk is the obvious move, and it produced something that looked broken rather than moody.

**What didn't work:** doc drift began here. The TDD's wave counts and "single-file build" line were never updated. **A spec that isn't maintained becomes a second, wrong source of truth** — by Session 6 I had to verify wave counts against `config.js` because the doc lied. Also visible: `d4b06c2` "polygon increase" followed a day later by `a3fe8d3` "fewer grass polygons", an overshoot-and-correct on scene density.

---

## Session 5 — Dummy rebuild, the frozen-arrow bug, onboarding audit
**2026‑09‑06** (`b380c35`) · *Training dummy visuals and arrow fix* · **First-hand**

**Built:** the training dummy remodelled with a topple-and-sink death; **the frozen-arrow fix** (one line); **the castle prompt now actually appears**; dummies exempted from `repairAll`; **an audit of the whole level-one onboarding sequence** that turned up four dead features; a callout queue, coin sweep halved, barricade unlock announcement, hero health bar.

**Key decisions:**
- **Dummies are one-shot props.** The free between-waves repair exists so the player doesn't lose towers; standing the practice targets back up would leave two of them mid-island for the rest of the level — including the one just cleared to earn the castle.
- **Tie the barricade reveal to its announcement**, not the phase change. That puts a UI unlock behind a lesson, so a flush must drain the queue and run every side effect if the player presses READY first — otherwise a quick starter loses barricades permanently.
- **Measure against the rig, not the screenshot.** The dummy overtopped the king; the health bar floated a body-length over his head because I used a flat offset and the king rig is scaled 0.621. Both are now derived.

**Biggest problems:**
1. **Arrows froze mid-air — and it was not a projectile bug.** The symptom pointed straight at arc/LOS code. Before changing anything I dumped the projectile list: **17 projectiles, all `state: "flying"`, all `t: 0`, all at the hero's exact muzzle.** Nothing was stepping them. `world.step` only called `combat.step(dt)` inside the `PHASE.WAVE` branch, so the hero acquired targets and fired but nothing advanced what he fired. **Dump the state before forming a theory** — five minutes of data beat any amount of reading `combat.js`.
2. **The castle prompt never appeared — a correct condition evaluated at the wrong time.** The gate was already right, but `refreshPanels()` only re-ran when the hero's *tier* changed, and the dummies stand **on tier 2** — so the tier change always fired first and the last dummy dying went unnoticed. **A correct predicate is half the job; when it's evaluated is the other half.**
3. **Four onboarding features were dead, and nothing errored.** `$('[data-build="archer"]')` — `$` is `getElementById`, these are attribute selectors, both lookups returned `null`, both call sites were `if (button)`-guarded, so the barricade hold and archer pulse simply did not exist. The "NEXT ATTACK" caption could never show (an inline `display:none` written every frame beats a class rule). A flag was assigned `Infinity` at all three sites, so the branch testing `!== Infinity` was unreachable. And the restart-wave click handler had been folded onto the end of its own section comment.
4. **A bug I introduced in my own fix, caught by my own instrument.** The callout queue pumped the next entry the instant the previous was *shown*, blanking a message mid-display. I only saw it because I logged actual DOM state across the transition instead of assuming the fix worked. **Verify the fix with the instrument that found the bug.**

**Learned:** **"silently returns null" is the worst failure mode a helper can have** — `$()` turned two broken features into *invisible* broken features, and nothing would have caught them except playing the tutorial, which none of these sessions do.

**Handed forward:** the five onboarding gaps now listed in Part 1, of which **tower upgrades is the biggest** — ten of twelve tower types live behind a radial menu nothing hints is there.

---

## Session 6 — Ocean waves, onboarding polish, placement colours
**2026‑09‑07** · *Ocean waves visual performance* · **First-hand**

**Built:** open-ocean wave crests (`water.js`) — twenty pointed crests that surface, spread and sink; one merged indexed geometry, one draw call, 40 triangles. Plus onboarding work: instructional text +2px, "ATTACK" caption removed from dummies, level 1 opening gold 50 → 30, a wave-one glow chain (archer button while affordable, then READY), a shake-and-flush-red refusal on unaffordable buttons, and the build hint changed from the movement ring to a 1×1 square beside the stairhead with a 1s delay.

**Key decisions:**
- **Geometry, not a shader field, for the waves.** The elegant option was a per-pixel field in the water plane's shader. Costed both: the water quad covers *every pixel*, so at pixel ratio 2 that's ~5.2M fragments running three `sin` calls — roughly 0.3–0.6ms/frame. Twenty merged meshes is ~0.02ms. **~20× cheaper, and it spends the budget where `batch.js` exists to protect it.**
- **Spot pool validated at build time.** 72 candidate positions land-tested once at load; respawning picks from the pool, so it can never stall a frame *or fail and drop a wave on the sand*.
- **Its own PRNG stream, not `ctx.rand`** — taking 20 numbers from the shared stream would have moved every structure and tree on the island.
- **The movement ring is reserved for movement.** The build hint became a placement square so one marker doesn't mean two things.

**Biggest problems:**
1. **The glow union that lit both buttons.** `archerPulse = defenseTutorialActive() || (firstBuild && canAfford)` looked like the conservative change. Testing across seven states showed that with no tower and no gold, **both** the archer button and READY glowed — pointing at a purchase the player couldn't make. **"OR it with the old behaviour" is not automatically safe.**
2. **A half-tile bug only a square marker could expose.** The build-hint search stepped out from `keep.x`/`keep.z` — the 2×2 castle's *centre*, 4.5 and 6.5 — so every candidate was a half-tile coordinate. `canPlace` accepted them and the old ring sat between four tiles naming none of them. Survivable for a floating pointer, not for a square. **A more precise UI element is a free correctness test on the data behind it.**
3. **The placement-validity colour bug — my first diagnosis was wrong.** Reported as "valid yellow looks red over green"; I treated it as a hue choice. Inspecting the live scene found **three stacked layers**: a solid near-black outline quad drawn *over* the fill, the hovered tile being painted dead-zone red *underneath* the marker (it sits at distance 0, inside the archer's `minRange`), and a denied state at 0.20 alpha that composited to olive. Valid and invalid both landed on dark brown, **ΔE 16.5 apart** — the two states were saying the same thing. Fixed all three layers. **Computing the composite found it in minutes; staring at it would not have.**
4. **Two self-inflicted process problems.** Line endings again (36 → 2,324-line diff), *the same class of bug as Session 1*. And the preview pane throttles — `document.hidden` is true, so `requestAnimationFrame` never fires and the game clock doesn't advance. I first misread that as the wave system being broken; the workaround was an offline Node harness for anything time-based.

**Learned:** **cost the option against the project's actual bottleneck**, not in the abstract — the shader field is the clever answer and the wrong one here. And **verification is not playtesting**; I confirmed a lot of state and played none of it.

---

## Where things stand / what's next

**Working:** all Session 6 changes are in and confirmed in the running game, no console errors. Crest system validated across 400 simulated seconds on all three levels — never on land, zero stacked crests.

**Uncommitted:** everything from Session 6 is working-tree only, across 9 files (`index.html`, `config.js`, `world.js`, `hud.js`, `theme.css`, `util.js`, `water.js`, `guide-view.js`, `guide-updater.js`). Plus this log.

**Next, in priority order:**
1. **Actually play level one start to finish.** No session in this log has. The wave-one glow chain, the 1s hint delay and the 30-gold opening were all verified by forcing state, never felt in sequence.
2. **Teach the radial menu.** Ten of twelve tower types are unreachable in practice. Biggest gap in the game.
3. **Reconcile the TDD with the code** — wave counts, "single-file build", enemy roster. A wrong spec is worse than none.
4. Music is specced (Celtic maritime folk, D Mixolydian build / D Dorian combat, 96 and 144 BPM) but **not produced or wired up**.
5. Commit the working tree before starting anything else.
