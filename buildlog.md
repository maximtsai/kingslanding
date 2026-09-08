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
- A king with a bow defends a small island from raiders who arrive by boat. Towers do most of the killing; the player covers the gaps.
- References: **Bad North** (island diorama, rotatable camera, boats you can see coming) and **Thronefall** (build-then-fight rhythm, single controllable hero).
- Each level is self-contained. **No meta-progression, no unlocks, no save system.**

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
- **A tower is bought once and never costs anything again.** Between waves every tower is repaired free at its current upgrade level, because otherwise upgrading would be a waste of money.
- Selling refunds 50% of everything spent on a tower, including upgrades.

### Controls
- Designed for a phone held upright.
- **Tapping the ground moves the king.** That is the default meaning of a tap.
- **Building takes three steps: arm, propose, confirm.** Tap a tower to arm it, tap the ground to propose a spot, press confirm to spend the gold. This exists so a mis-tap can never cost money.
- **Placing the castle works the same way** — until you press the castle button, tapping the ground just moves the king.
- **Camera:** rotate by dragging, zoom with buttons, follows the king with a slight ease.
- The camera is **orthographic**, meaning objects stay the same size regardless of distance. Chosen because a perspective camera makes the island's raised levels look slanted when you rotate.
- Dragging rotates 1:1 with your finger. Smoothing was tried and felt like input lag.

### Art direction
Two goals: run smoothly on a phone, stay readable at small scale.

- **Flat-shaded low-poly, no textures.**
- **No shadows.** Each object sits on a small dark patch so it reads as grounded.
- **Soft even lighting from all directions**, because a strong directional light crushes the cliff faces to near-black. Trade-off: gentle slopes then look flat, so relief has to be painted into the model's colours.
- **Animate size, never transparency**, so overlapping effects never go muddy.
- **Saturated colours are reserved for the king and his banners.** The environment never uses red.
- **The water plane doubles as the sky.**
- **The evening tint during waves changes colour only, never brightness.**
- **Weaker devices automatically get lower resolution and less decorative animation.**

### Onboarding (level 1 only)
The opening unlocks things in order. Each step waits on a real game condition rather than a fixed script, so an unusual play order still works:

1. The king lands on the beach.
2. He climbs the stairs to the raised part of the island.
3. He destroys both training dummies.
4. The "place your castle" prompt appears.
5. The player places the castle, then is guided to build one archer tower.
6. Wave 1 begins.

- **The castle prompt needs the king on the upper level *and* both dummies destroyed**, re-checked continuously — see Session 5, problem 2.
- **Training dummies stay destroyed**, unlike everything else, which is repaired free between waves.
- **The barricade is hidden until after wave 1**, so the first build phase teaches one thing.
- **Tutorial messages share one popup and queue up.** Anything unlocked by a message must also unlock if the player skips ahead.
- **Still not taught:** tower upgrades and the radial menu (biggest gap — ten of twelve tower types sit behind it), picking up coins, that the build phase is untimed, hero death, and cliff-jumping.

---

# PART 2 — Session log

## Session 1 — Diorama art pass and performance
**2026‑08‑29** (commit `8200bc3` "first") · *Game visual improvements, Bad North…* · **First-hand**

A standalone island scene with no gameplay in it yet. Its twelve files were later moved into `src/render/`, still the project's layout today.

**Built:** an art pass toward Bad North's look; a performance fix taking the scene from 582 drawing instructions to 20; two tower models; the island grown from 8×8 to 10×10 tiles.

**Decisions:**
- Merged the scenery into a few combined objects rather than simplifying models, because each separate drawing instruction costs more than the triangles inside it.
- No shadows, as a firm rule. It has held for the whole project.

**Problem:** the cape looked stiff. The code set its left-right position but never varied its depth, making it a flat sheet that just widened as it fell. Rebuilt so each row curves around the body.

**Pivot:** over-desaturated the palette, then tried to land halfway by blending 50/50 with the original. That flattened the sky gradient into one colour. Fixed by keeping the gradient's spread and changing only hue and saturation.

**Learned:** when something looks wrong, check the maths before adjusting the art.

**Stood at:** a 10×10 island at 60fps, with no gameplay.

---

## Sessions 2–4 — Tooling and visual polish
**~2026‑08‑30 → 09‑05** · *Level setup file storage* / *Game lighting and colors* · **Reconstructed from commits, low confidence**

**Built:** checks that run when a level loads, so a bad level fails immediately instead of breaking mid-wave; a browser-based level editor so levels can be drawn rather than typed; lighting and colour work; model fixes, including both bows having been built rotated ninety degrees.

**Decision:** the evening tint changes colour only. The first version dimmed the main light, darkened the screen edges, and cut saturation, which read as haze rather than dusk — it looked broken instead of atmospheric. Worth remembering, because dimming the lights is the obvious thing to try.

**Didn't work:** scene detail went up and then came straight back down — "polygon increase" one day, "fewer grass polygons" the next.

---

## Session 5 — Dummy rebuild, the frozen-arrow bug, onboarding audit
**2026‑09‑06** (commit `b380c35`) · *Training dummy visuals and arrow fix* · **First-hand**

**Built:** the training dummy remodelled with a topple-and-sink death; a one-line fix for arrows freezing mid-air; the castle prompt actually appearing; dummies excluded from the free repair; an audit of the level 1 tutorial that found four broken features; a queue so tutorial messages stop overlapping; the coin sweep slowed to half speed; a barricade unlock announcement; a health bar over the king.

**Decisions:**
- Dummies stay destroyed, because the free repair would otherwise stand them back up every build phase — including the one the player just destroyed to earn the castle.
- The barricade button appears with the message explaining it, not on the phase change. That means a skipped message must still apply its unlock, or a fast player loses barricades permanently.
- Sizes and positions are calculated from the model rather than typed in. Two things placed by eye this session were both wrong: the dummy came out taller than the king, and the health bar floated a body-length above his head.

**Problems:**
1. **Arrows froze mid-air, and it was not an arrow problem.** I printed the list of arrows in flight: 17 of them, all marked "flying", all with zero time elapsed, all sitting where they were fired. Nothing was moving them. The game only advanced projectiles during a wave, so in the build phase the hero aimed and fired but nothing he fired ever moved.
2. **The castle prompt never appeared.** The condition was correct, but it was only re-checked when the king's height level changed. The dummies stand on the upper level, so the level change always happened first and the last dummy dying went unnoticed.
3. **Four tutorial features were dead and nothing reported an error.** Two buttons were looked up incorrectly and never found, killing the barricade hold and the archer button pulse. The "NEXT ATTACK" caption was hidden every frame in a way that overruled the code meant to show it. A timing value was set so its branch could never run. A click handler had been absorbed into a comment, so the restart-wave button did nothing. Every case was written defensively enough that nothing crashed, which is why nobody noticed.
4. **My own fix broke a message.** The new queue advanced as soon as a message was shown rather than when it finished, blanking one mid-sentence. Caught by logging what the page actually displayed instead of assuming the fix worked.

**Learned:** look at the real data before forming a theory. In both the frozen arrows and the castle prompt, the symptom pointed at the wrong file and the data pointed at the right one immediately. A feature that fails silently is worse than one that crashes.

**Handed forward:** tower upgrades are still never taught — ten of twelve tower types sit behind a menu that opens when you tap a tower, and nothing tells the player tapping does anything.

---

## Session 6 — Ocean waves, onboarding polish, placement colours
**2026‑09‑07** · *Ocean waves visual performance* · **First-hand**

**Built:** twenty wave crests on the open ocean that rise, shrink away, and reappear elsewhere. Tutorial changes: instructional text 2px larger, the "ATTACK" label removed from the dummies, level 1 starting gold cut from 50 to 30, a glow that moves from the archer button to READY once you cannot afford another tower, a shake-and-red-flash on unaffordable buttons, and the build hint changed from the movement marker to a square outline on the target tile.

**Decisions:**
- Built the waves as shapes rather than a pattern drawn across the water, because the water covers the whole screen and a per-pixel pattern would recalculate roughly 5.2 million times a frame.
- Valid wave positions are worked out at startup, so a reappearing wave picks from a pre-approved list and can never stutter or land on the beach.
- The ring-and-arrow marker now only means "go here". The build hint was using it too, so one symbol meant two things.

**Problems:**
1. **A glow lit two buttons at once.** I combined the old tutorial condition with the new affordability condition using OR, which felt safe. With no towers and no gold, both the archer button and READY glowed — pointing at a purchase the player could not make. Made the two conditions mutually exclusive.
2. **The build hint sat between tiles.** It measured outward from the castle's stored position, which is the centre of its 2×2 footprint, so every suggestion landed on a half-tile. The old floating ring hid this; a square outline has to sit on one tile, so it showed up immediately.
3. **The placement highlight looked like a refusal.** Reported as "valid yellow looks red over green", which I first treated as a bad colour choice. Three see-through layers were stacked on the tile: a solid dark square drawn on top of the fill instead of a hollow border, the tower's range overlay painting that tile red because a tower cannot shoot its own square, and an "invalid" colour so faint it came out olive. Valid and invalid ended up nearly the same brown. Fixed all three.

**Learned:** judge a technical option against this project's actual bottleneck, not in the abstract. Calculating what stacked colours produce found the highlight bug in minutes where looking harder would not have. And checking that code works is not the same as playing the game — I confirmed a lot this session and played none of it.

---

## Session 7 — Training dummies drop gold
**2026‑09‑08** · *First-hand*

**Built:** destroying a training dummy now drops a 1-gold coin, like a killed enemy. Level 1's starting gold went from 30 to 38 to cover it.

**Decision:** dummies drop gold so the first thing the player destroys teaches the game's core rule — kill something, it drops gold — instead of that lesson landing silently on wave 1's first casualty.

---

## Session 8 — Rising cost on archer towers and barricades
**2026‑09‑08** · *First-hand*

**Built:** the archer tower and the barricade now cost 10 gold more for each one already alive on the field (the 4th archer tower costs 15 + 30 = 45, not a flat 15). The refund on selling one reflects what was actually paid, not the listed base price. Barricade's base cost dropped from 10 to 5 to compensate for it now climbing too.

**Decision:** priced these two flat instead of letting them stay flat, for two reasons. First, a flat price makes "cover every open tile with the cheapest option" the dominant strategy, which is both a cluttered, less readable island and a build phase with nothing left to decide once that tiling is done. Second, a rising price nudges the player toward upgrading what is already down — the more interesting tier-2 and tier-3 towers — instead of buying more of the same tier-1 building.

---

## Where things stand / what's next

**Working:** all Session 6 changes are in and running with no startup errors. The wave system was tested over 400 simulated seconds on all three levels — no wave ever appeared on the island, and none overlapped.

**Next, in priority order:**
1. **Play level 1 start to finish.** No session has. The button glow, the delayed build hint, and the reduced starting gold were all tested by forcing game state, never by playing through in order.
2. **Teach the tower upgrade menu.** Ten of twelve tower types are effectively unreachable. Biggest gap in the game.
3. Music is specced (Celtic maritime folk, brighter for building, darker for combat, 96 and 144 BPM) but not made or added. The game has synthesized sound effects only.
4. Commit the working folder, which still holds all of Session 6.
