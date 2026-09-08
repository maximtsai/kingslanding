# Build Log: King's Landing (Hero Tower Defense)

**Genre:** Tower Defense / Action Hybrid
**Platform:** Browser, mobile-first portrait (fixed 720×1280 stage, scaled to fit)
**Stack:** Three.js, vanilla ES modules, no build step, no asset files (audio is synthesized Web Audio)

**Pitch:** You are a king with a bow defending a small island diorama from seaborne raiders. Towers do the bulk of the killing; you plug the holes. Boats approach visibly so you get time to reposition, then the wave lands.

---

## About this log — read this first

This log was **generated retroactively at the end of Session 6**, not kept live from Session 1. That matters for how much you should trust each part:

- **Part 1 (Decisions locked)** is high confidence. It is reconstructed from the code, `hero-td-prototype-tdd.md`, `architecture.md`, and `src/config.js`, all of which state their reasoning in unusually explicit comments. Where a decision is recorded in a comment I have treated that as primary evidence.
- **Sessions 1–5** are **reconstructed**, not remembered. I was not present for them. They are inferred from git history (28 commits, 2026‑08‑29 → 2026‑09‑06), from session titles, and from decision rationale written into code comments. **The mapping of session → commits is inferred and may be off by a session boundary.** Where I am guessing, I say so.
- **Session 6** is a full first-hand record of a live working session and is the most reliable entry here.

Commit messages in this repo are mostly single words ("updates", "tweaks", "stable"), so they carry almost no information. Nearly everything reconstructed below comes from *code comments*, not commit messages. **That is itself the lesson: the comments saved this log, the commit messages did not.**

---

# PART 1 — Decisions locked so far

### Concept and references
- King with a bow defends a small island from seaborne raiders. Towers kill most things; the hero plugs gaps.
- Reference points are explicit: **Bad North** for the island diorama, rotatable camera, boat telegraphing and readable low-poly look. **Thronefall** for the build/combat phase loop and the single controllable hero.
- Each level is standalone. **No meta-progression, no unlocks, no save system.** Nothing carries between levels.

### Core loop
```
Castle placement (mandatory 2×2, no wave can start until valid)
  → Build phase (untimed) — place/upgrade/sell towers, hero moves freely
  → player presses READY
  → Wave — boats spawn on open water, ~10s approach, land, path to the castle
  → combat until clear, gold auto-collects to the hero
  → back to Build
```
- **Wave counts as shipped: Level 1 = 4, Level 2 = 6, Level 3 = 6.** (The TDD still says 6/8/10 — see *Known drift* below.)
- Towers are a **one-time capital purchase, never upkeep.** Between waves everything is repaired free *at its full upgrade tier* — if an upgraded tower came back as T1, upgrading would be a trap and nobody would do it.
- Sell refunds 50% of **total invested** gold, not base cost.

### Controls
- Mobile-first portrait. Fixed 720×1280 stage; all HUD maths is in stage units, never real pixels.
- Tap the ground = move the king. **A tap PROPOSES, it never buys.** With something armed on the build bar, a tap picks the tile and a separate confirm button spends the gold.
- Camera: drag to rotate 1:1 (no tween — a tween on a drag reads as input lag); buttons ease. Zoom via buttons/pinch.
- Castle siting is **armed, never automatic** — until the castle button is pressed, a tap means what it means everywhere else.

### Camera
- **Orthographic**, 35° pitch, rotatable yaw, follows the king with frame-rate-independent exponential lag.
- Ortho is deliberate: a perspective swivel would shear the elevation tiers, which is the one thing this projection was chosen to avoid.
- Screen shake translates camera *and* look-at target by the same offset so it never swivels.

### Architecture (hard rules, from `architecture.md`)
1. **Simulation must not depend on Three.js, DOM, or audio.** Sim records state and events; presentation consumes them.
2. **Rendering reads state, does not mutate gameplay state.**
3. **Gameplay tunables live in `src/config.js`**, not scattered through sim code.
4. `src/feedback.js` is the **only** sanctioned consumer of simulation events.
5. `src/stairs.js` is shared by sim elevation and rendering, so a visible riser is also where a walker changes height.
6. Fixed-step sim (`config.sim.HZ`) with an interpolation alpha handed to render.

### Art direction
- Low-poly flat-shaded diorama. **No textures, no shadow maps, no blur or filter passes.**
- Lighting is **ambient-dominant**: soft warm key, cold rim, large ambient floor. A hard key would crash the vertical cliff faces to grey.
- All scene colour lives in `src/render/palette.js`. **Saturated hues are reserved for the king and the banners** so they read instantly; the environment is forbidden red.
- **The water plane doubles as the sky.** There is no skybox — one 320-unit quad carries a screen-vertical gradient and covers the whole frame, so the renderer's clear colour is never seen.
- The wave-phase "evening" tint is **hue only**. Every light intensity is identical to its daylight value. The rule, written into `config.js`: *"Change what colour the light is, not how much."*
- Enemies are **warm-dark, not blue-dark** (`0x3a2b2e`), so raiders lean red without breaking the environment's no-red rule.

### Performance model
- **The budget is draw calls and fill, not vertices.** `batch.js` collapses all static scenery into single merged buffers at boot; anything added after the freeze cannot be batched.
- `gpuTier()` gates pixel ratio (2 desktop / 1.5 mobile / 1 weak), MSAA, and whether decorative animation runs at all.
- One seeded PRNG generates the whole scene. **Inserting a draw from it anywhere shifts every random decision downstream**, so new systems must use their own stream.

### Scope guardrails
- 3 levels, 2 tower lines × 3 tiers, 3 enemy types (only `grunt` is used in the shipped wave tables), one hero.
- Level 1 opens with **30 gold** (`economy.levelStartGold.one`), exactly two archer towers at 15 each. Levels 2–3 use the default 50.

### Known drift (things the docs say that the code does not)
- **TDD says 6/8/10 waves per level; `config.waves.levels` ships 4/6/6.** The code is the truth.
- **TDD says "single-file build".** It has not been single-file for a long time — the project is ~40 ES modules.
- TDD's enemy roster is larger than what the wave tables actually spawn.

---

# PART 2 — Session log

## Session 1 — Initial build and visual direction
**Dates:** ~2026‑08‑29 → 08‑30 (commits `a35eb1e` "ignoring" → `e52163a` "model improve")
**Session title:** *Game visual improvements, Bad North…*
**Tool:** Claude (Claude Code)
**Confidence: reconstructed.** No first-hand record; inferred from commit dates and code comments.

**What was built:** The skeleton that everything since has hung off — board/grid with elevation tiers, the sim/render split, the orthographic diorama camera, the low-poly island, and the first pass at units and structures.

**Key decisions and why:**
- **Bad North as the visual north star** — island diorama, rotatable camera, boat telegraphing. This is stated at the top of the TDD, so it was a deliberate early anchor rather than something arrived at.
- **Orthographic camera.** The TDD is explicit that this was chosen so elevation tiers stay readable and never shear.
- **Sim/render separation as a hard rule, not a preference.** `architecture.md` states it first among "Important rules." Given how much render work happened in later sessions, this was the highest-leverage early call.
- **No asset pipeline.** Audio synthesized in Web Audio, geometry generated in code, no textures. For a jam prototype this removes an entire category of work and load-time failure.

**What I can't tell you:** whether these were argued or assumed, and what got thrown away first.

---

## Session 2 — TDD expansion
**Dates:** ~2026‑08‑30 → 09‑01 (`f802043` … `5452363` "cleanup")
**Session title:** *Hero-td-prototype-tdd game expansion*
**Tool:** Claude (Claude Code)
**Confidence: reconstructed.**

**What was built:** `hero-td-prototype-tdd.md` grew into the ~900-line spec it is now — enemy silhouette rules, tower lines and tiers, elevation/combat interaction, level authoring, load-time validation.

**Key decisions and why:**
- **Write the design down before building more of it.** The TDD is unusually specific about *rejected* options, which is the useful part (e.g. why enemies are long-bodied and short-legged, why raiders are warm-dark).
- **Load-time validation of board and wave data.** `board.js` throws on bad levels — e.g. `MIN_BEACH_TILES` fails a level with *"the waterline is almost all cliff."* Catching authoring errors at boot rather than mid-wave.
- **Free repair at full tier** locked here as an economy rule, with the reasoning recorded.

**What didn't work / honest note:** this is where the doc drift began. The TDD's wave counts (6/8/10) and "single-file build" line were never updated as the code moved. A spec that isn't maintained becomes a *second, wrong* source of truth — by Session 6 I had to verify wave counts against `config.js` because the doc lied.

---

## Session 3 — Level authoring and storage
**Dates:** ~2026‑09‑01 → 09‑03 (`14ca453` "level editor, but broken visuals")
**Session title:** *Level setup file storage*
**Tool:** Claude (Claude Code)
**Confidence: reconstructed.**

**What was built:** `src/sim/level-data.js` as the single source of level truth (heights, ramps, houses, `shoreFallback`, `intro.land`, `heroSpawn`), plus `tools/level-editor.html` and a write endpoint in `devserver.py` (`POST /api/save-levels`) so the browser editor can put a level back on disk.

**Key decisions and why:**
- **A dev server that can write files.** A browser page can't save, so the editor POSTs JSON and Python writes it. That turns localhost into an authoring tool instead of just a static host.
- **`devserver.py` sets `no-store` on everything.** The comment explains why: a cached ES module survives a hard reload, which turns every edit into a guessing game about whether you're looking at your change. Small thing, large time saving.

**Biggest problem:** the commit is literally named *"level editor, but broken visuals"* — the editor landed working and the render side did not. That was carried as known breakage into the next session rather than blocking on it.

**What I learned (inferred):** shipping a tool half-broken and naming the breakage in the commit is a reasonable jam trade, but only because the next session picked it straight up.

---

## Session 4 — Lighting and colour
**Dates:** ~2026‑09‑04 → 09‑05 (`5b2937d`, `12dba65`, `d329b6f` "visual ui tuneup", `d4b06c2` "polygon increase", `a3fe8d3` "fewer grass polygons", `69d0131` "color bal")
**Session title:** *Game lighting and colors*
**Tool:** Claude (Claude Code)
**Confidence: reconstructed, but the reasoning below is quoted from code, not guessed.**

**What was built:** The ambient-dominant light rig, the day→evening blend, the grade pass (saturation/contrast/vignette), and a palette consolidation.

**Key decisions and why:**
- **The evening tint is a hue shift, not a dimmer.** This is the clearest recorded pivot in the whole repo. `config.js` says the first version *"dimmed the key, lifted the vignette and pulled saturation down, and the result read as haze rather than as evening."* The fix was to hold every intensity identical to daylight and move only hue. The comment insists: *"That is not laziness, it is the whole fix."*
- **Fog is pushed further out in the evening, not pulled in** (44→62 near, 118→150 far) — because distance fog is the single largest contributor to a hazy read.
- **Enemies re-hued from cool blue-black `0x2e2f35` to warm `0x3a2b2e`** at matched luminance. They are exactly as dark as before; only the hue moved. This resolved a conflict where the environment's no-red rule and the "gameplay is warm-and-dark" rule disagreed.
- **The grade pass is deliberately NOT touched by the evening blend**, so the dev overlay's sliders stay under the player's control.

**Pivot:** `d4b06c2` "polygon increase" followed a day later by `a3fe8d3` "fewer grass polygons" is a visible overshoot-and-correct on scene density. Detail went up, cost showed, detail came back down.

**What didn't work:** the first evening pass, described above. Worth noting that the failure mode was *plausible* — dimming light to suggest dusk is the obvious move, and it produced something that looked broken rather than moody.

---

## Session 5 — Training dummies, hero walk, arrow/bow fixes
**Dates:** ~2026‑09‑05 → 09‑06 (`49937f6` "Tweaks", `04d28f1`, `bb2a2d5` "Hero walk", `48ea6bc` "buncha updates", `b380c35` "updates")
**Session title:** *Training dummy visuals and arrow fix…*
**Tool:** Claude (Claude Code)
**Confidence: reconstructed.**

**What was built:** The onboarding beat where the king climbs to the plateau and beats two training dummies; hero walk animation; and a set of rig fixes.

**Key decisions and why:**
- **Training dummies are one-shot props** — *"destroyed is destroyed"* — deliberately exempt from the free between-waves repair that applies to everything else. They are a tutorial gate, not a structure.
- **Dummies gate the castle prompt.** The castle can't be sited until they're down, which is what forces the player through the combat tutorial.

**Biggest problems (both recorded as bugs found and fixed):**
- **Both bows were built ninety degrees wrong.** A whole TDD section is devoted to it. Two independent rigs shared the same mistake, which suggests a shared wrong assumption about the local axis rather than two typos.
- **A silent `null` from `$()`.** `hud.js` records: *"querySelector, not `$`: these are matched by attribute, and `$` is getElementById. Passing a selector to it returns null silently, which took the barricade hold and the archer pulse out of the tutorial without a word."* Two tutorial features were dead and nothing errored.
- **Panelled cliff faces removed** — *"it was detailing a sliver and drowning the rest"* — which then forced the surf ring to reach further out (0.045 → 0.072) because the cliff bevel had been doing half the work of reading as a waterline.

**What I learned from reading this back:** the `$()` bug is the most instructive thing in the repo's history. A helper that returns `null` instead of throwing turned two broken features into *invisible* broken features. Nothing in the codebase would have caught it except playing the tutorial.

---

## Session 6 — Ocean waves, onboarding polish, placement colours
**Date:** 2026‑09‑07
**Session title:** *Ocean waves visual performance*
**Tool:** Claude Opus 5 (Claude Code, desktop app) with an in-app browser for live verification
**Confidence: first-hand, full detail.**

### What we built

**1. Open-ocean wave crests (new system, `src/render/water.js`)**
Twenty pointed crests that surface, spread and sink on the open water outside the coastline. One merged indexed geometry, one draw call, 40 triangles.

**2. Onboarding / HUD changes**
- Instructional pill text +2px across five elements (`#guide-click-here`, `#place-confirm-label`, `#place-denied .pill`, `#incoming-tutorial-label`, `#castle-prompt .sub`).
- Removed the "ATTACK" caption over training dummies (marker stays, word goes).
- Level 1 opens on 30 gold instead of 50, via a new `economy.levelStartGold` map.
- Wave-one glow chain: the archer button glows while another tower is affordable, then the glow moves to READY.
- Unaffordable build buttons now shake and flush red on click.
- The build-defense hint changed from the ring+triangle marker to a 1×1 hollow white square, anchored beside the stairhead, with a 1s delay, relabelled "BUILD ARCHER TOWER".
- Placement validity colours reworked (see problem 5).

### Key decisions and why

- **Geometry, not a shader field, for the waves.** The first proposal was a per-pixel wave field in the water plane's own fragment shader — elegant and zero geometry. I costed both: the water quad covers *every pixel* (`frustumCulled = false`, 320 units), so at pixel ratio 2 that's ~5.2M fragments running a hash with three `sin` calls, roughly 0.3–0.6ms/frame. Twenty small meshes merged into one buffer is ~0.02ms. **~20× cheaper, and it spends the budget in the place `batch.js` exists to protect.** It also allows an authored *pointy* silhouette, which a threshold field cannot do.
- **Animate size, never alpha.** Crests scale 0 → full → 0 and are reseated at the instant they are at zero, so relocation is invisible. This follows the existing surf ring, which breathes its *width* rather than its opacity. It also keeps everything opaque, which was the original brief ("no blurs or fuzziness").
- **Spot pool validated at build time.** 72 candidate positions are land-tested once at load; respawning picks from the pool. The polygon test is the entire cost, so doing it up front means a respawn can never stall a frame *or fail and drop a wave on the sand*.
- **Crests share the sky gradient's `uBottom` uniform object**, not a copy of its value. `applyEvening` mutates that colour in place, so the crests track dusk for free and can't glow at night the way a hard-coded white would.
- **Its own PRNG stream, not `ctx.rand`.** `scene.js` warns that every builder draws from one shared PRNG and inserting a call reshuffles everything downstream. Taking 20 numbers from it would have moved every structure and tree on the island.

### Pivots

- **Shader field → geometry** (above). What changed my thinking was actually costing it against *this* project's bottleneck rather than in the abstract.
- **Crest count 12 → 20**, which broke the spacing rule and forced a fix (problem 3).
- **Glow predicates**: I first wrote the archer glow as a union with the existing `defenseTutorialActive()`, thinking it was the conservative choice. Testing proved it wasn't — see problem 2.
- **Denied-placement alpha**: I planned both validity states at the same opacity, then measured and split them (problem 5).

### What changed after testing

I want to be precise here, because it matters for how much weight to give this section: **I did not playtest.** I drove game state programmatically from the browser console (forcing phases, destroying dummies, placing the castle, hovering tiles) and verified rendered output and scene state. That catches rendering and logic errors. It does **not** catch feel, pacing, or difficulty. Everything below is "changed after *verification*", not after play.

- **Wave crests pointed the wrong way and were too big** — flipped `SWELL_HEADING` by π, cut max size 1.35 → 1.10.
- **Denied build tile read as a dirt patch**, not a refusal. Measured it: red at 0.50 alpha over grass composites to hue 24°/38% saturation — orange-brown. Raised to 0.75, which holds hue 12°/62% and reads red.
- **Refusal flash was a full recolour** at 0.60 alpha; softened to 0.42 so it reads as a flush rather than a repaint.

### The biggest problems, and how we solved them

**1. A shader-string escaping bug that broke the boot, twice.**
My file-patching went through a shell heredoc, and `].join('\n')` came out as a literal newline inside a JS string — an unterminated string that killed the module. It happened on two separate edits to the same file. `node --check` passed the first time (misleading), and the only symptom was a blank canvas plus one `SyntaxError` in the console. **Fix:** check for it explicitly after every edit to `water.js` (`grep -n "join('" | cat -A`). **Lesson: this file's shader strings are a known hazard for tooling that goes through a shell.**

**2. The glow union that lit both buttons.**
`archerPulseActive = defenseTutorialActive() || (firstBuild && canAfford)` looked conservative. Testing across seven states showed that with no tower built and no gold, *both* the archer button and READY glowed — the game pointing at a purchase the player couldn't make. **Fix:** made them mutually exclusive on affordability alone. `defenseTutorialActive()` still places the guide marker; it no longer votes on which button glows. **Lesson: "OR it with the old behaviour" is not automatically the safe change.**

**3. 20 crests saturated the spacing rule.**
At `CREST_SPACING = 2.2`, twenty exclusion discs need roughly the entire area of that annulus. 12.9% of respawns gave up and took a crowded spot, and **up to 3 crests could share one exact position**, stacking into a single shape. **Fix:** spacing down to 1.7, and the test now returns a *rating* — sharing a spot exactly is never acceptable, sitting close usually is. Settling dropped to 1.5–4.6% and taken-spot collisions to **zero** across 400 simulated seconds on all three levels.

**4. A half-tile bug that only a square marker could expose.**
Switching the build hint from a floating ring to a 1×1 square revealed that the candidate search stepped out from `keep.x`/`keep.z` — the 2×2 castle's *centre*, 4.5 and 6.5 — so every candidate was a half-tile coordinate like `[4.5, 5.5]`. `canPlace` accepted them and the old ring sat between four tiles naming none of them. Survivable for a floating pointer; not for a square that has to sit *on* a tile. **Fix:** search from `keep.i`/`keep.j`, measure distance from the centre. **Lesson: a more precise UI element is a free correctness test on the data behind it.**

**5. The placement-validity colour bug — my first diagnosis was wrong.**
Reported as "valid yellow over green looks red." My first answer treated it as a hue-choice problem. That was incomplete. Inspecting the live scene found **three** stacked layers:
   - `outline` was a **solid** quad in near-black at 50% opacity, and `marker.position.z = -0.004` put the gold fill *underneath* it — so half of the fill colour was mixed with black.
   - `probeCoverage` measures centre-to-centre, so the hovered tile is distance 0, inside the archer's `minRange: 0.5` → returned `'dead'` and painted the tile **red underneath the marker**.
   - The denied state sat at 0.20 alpha, which composites to `#97935f` — an olive, not a red.

   Net result: valid = `#6c5c3d` (dark brown), invalid = `#6a5136` (dark brown), **ΔE 16.5 apart**. The two states were saying the same thing. **Fix:** hollow ring instead of a plate, footprint excluded from the coverage pass, and cyan `#4fd6e0` / red `#e8402f`. Valid and invalid are now ~ΔE 58 apart. Cyan also sidesteps a rule the palette states itself — `#f2c14e` *is* `palette.crown`, so a valid tile was wearing the king's reserved colour — and fixes red-green colourblind ambiguity that gold-vs-red had completely.

**6. Two self-inflicted process problems.**
   - **Line endings.** My Python patch scripts rewrote CRLF files as LF, inflating one diff from 36 to 2,324 lines. Caught twice via `git diff --stat` and repaired. Now every patch preserves the file's original ending.
   - **The browser pane throttles.** `document.hidden` is true for the preview pane, so `requestAnimationFrame` never fires and the game clock does not advance — `world.time` moved 0.47s in 30 wall-clock seconds. I initially misread this as the wave respawn being broken. **Workaround:** an offline Node harness for anything time-based, plus a rAF collector driven by repeated screenshots when live confirmation was needed. Screenshots also lag one action behind the JS that set up the frame, which cost a wrong conclusion before I spotted it.

### What I learned

- **Cost the option against the project's actual bottleneck, not in the abstract.** The shader wave field is the "clever" answer and the wrong one here, purely because this project is fill- and draw-call-bound by design.
- **Compositing maths beats eyeballing for overlay colours.** "Yellow looks red" was a real symptom with an unguessable cause. Computing the composite found three stacked layers in minutes; staring at it would not have.
- **Verification is not playtesting, and I should not let it pass for it.** I confirmed a lot of state this session and played none of it.
- **Precision in one place audits another.** The square marker found a half-tile bug the ring had been hiding for the whole project.
- **The code comments in this repo are the actual design document.** They carry the rejected options and the reasons. The TDD has drifted; the comments have not.

### Where things stand / what's next

**Working and verified:** all Session 6 changes are in, syntax-checked, and confirmed in the running game. No console errors on boot. Crest system validated across 400 simulated seconds on all three levels — never on land, worst-case clearance 1.02 units, zero stacked crests.

**Uncommitted.** Everything from this session is working-tree only, across 9 files:
`index.html`, `src/config.js`, `src/sim/world.js`, `src/ui/hud.js`, `src/ui/theme.css`, `src/render/util.js`, `src/render/water.js`, `src/render/guide-view.js`, `src/render/guide-updater.js`.

**Next, in priority order:**
1. **Actually play level one start to finish.** The wave-one glow chain, the 1s hint delay, and the 30-gold opening were all verified by forcing state — none has been felt in sequence. The tutorial beat is the most likely thing to be subtly wrong.
2. **Reconcile the TDD with the code** — wave counts, "single-file build", enemy roster. A wrong spec is worse than none.
3. **Check the "BUILD ARCHER TOWER" pill near frame edges.** It's 46% of stage width (up from 32%); fine mid-plateau, possibly clipping if the suggested tile ever sits near a corner.
4. Two music tracks were specced this session (Celtic maritime folk, D Mixolydian build / D Dorian combat at 96 and 144 BPM) but **not produced or wired up**. `audio.js` is still synthesized SFX only.
5. Commit this working tree before starting anything else.
