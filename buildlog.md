# Build Log: King's Landing (Hero Tower Defense)

**Genre:** Tower Defense / Action Hybrid
**Platform:** Browser, mobile-first portrait (fixed 720×1280 stage, scaled to fit)
**Stack:** Three.js, vanilla ES modules, no build step, no asset files (audio is synthesized Web Audio)

**Pitch:** A king with a bow defends a small island from seaborne raiders. Towers do the bulk of the killing; you plug the holes. Boats approach visibly, so you get time to reposition before the wave lands.

---

## About this log

Generated retroactively by asking past sessions and exploring git commits. Focused on gameplay and balance decisions; art and engineering work is noted only where it served a gameplay purpose.

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
- **Archer towers and barricades cost 10 gold more for each one already alive on the field** — a flat price makes tiling every open tile with the cheapest option the dominant strategy; a rising price pushes the player toward upgrading what's already down instead.

### Controls
- Designed for a phone held upright. **Tapping the ground moves the king** — the default meaning of a tap.
- **Building takes three steps: arm, propose, confirm.** A mis-tap can never cost money.
- **Placing the castle works the same way** — until the castle button is pressed, tapping the ground just moves the king.
- **Camera is orthographic** (objects stay the same size regardless of distance) so the island's raised tiers don't look slanted when rotating. Dragging rotates 1:1; smoothing felt like input lag.

### Art direction
Serves two gameplay goals only: run smoothly on a phone, and stay readable at a glance during combat.
- Flat-shaded low-poly, no shadows, soft omnidirectional lighting — keeps frame rate up and avoids cliff faces crushing to black.
- Effects animate by scaling, never by fading, so overlapping hits stay legible instead of turning muddy.
- Weaker devices automatically drop resolution and decorative animation.

### Onboarding (level 1 only)
Unlocks in order, each gated on a real game condition rather than a script, so an unusual play order still works:
1. King lands on the beach and climbs to the raised part of the island.
2. He destroys all training dummies (currently 3).
3. The "place your castle" prompt appears; the player places it and is guided to build one archer tower.
4. Wave 1 begins.

- **Training dummies stay destroyed** between build phases, unlike everything else, which is repaired free.
- **Barricades stay hidden until after wave 1**, so the first build phase teaches one thing at a time.
- **Destroying a dummy drops a coin**, same as an enemy kill — this is the first thing the player destroys, so it's what teaches "kill something, it drops gold" before wave 1 does. When the last dummy falls, every coin on the ground flies to the king immediately, since there's no wave-clear sweep yet to collect them otherwise.
- **Still not taught:** tower upgrades and the radial menu (biggest gap — ten of twelve tower types sit behind it), picking up coins manually, that the build phase is untimed, hero death, and cliff-jumping.

---

# PART 2 — Session log

## Session 1 — Foundational art pass
**2026‑08‑29** (commit `8200bc3`) · **First-hand**

A standalone island scene with no gameplay yet — the visual and performance foundation (582 → 20 draw calls) everything else was built on. No design decisions of note.

---

## Sessions 2–4 — Tooling
**~2026‑08‑30 → 09‑05** · **Reconstructed from commits, low confidence**

Added level-load validation (a bad level fails immediately instead of breaking mid-wave) and a browser-based level editor. No gameplay or balance changes.

---

## Session 5 — Onboarding fixed
**2026‑09‑06** (commit `b380c35`) · **First-hand**

**Decisions:**
- Training dummies stay destroyed rather than being repaired free like everything else, because the free repair would otherwise stand them back up every build phase — including the one the player just cleared to earn the castle.
- The barricade unlock is tied to its explanation message firing, not to the phase change, so a player who skips ahead can't lose barricades permanently.

**Fixed:** the castle-placement prompt wasn't appearing (it was only re-checked on a game-state change that happened to fire before the condition it needed was true), and projectiles fired during the build phase were freezing in mid-air instead of flying. Both were onboarding-blocking.

---

## Session 6 — Tutorial pacing and starting gold
**2026‑09‑07** · **First-hand**

**Decisions:**
- Level 1 starting gold cut from 50 to 30 (later adjusted further in Sessions 7–8), so the "build until you cannot" opening beat ends on an empty purse instead of an awkward leftover.
- The archer-button tutorial glow now tracks affordability directly (build vs. READY are mutually exclusive glows) instead of OR-ing two conditions, which had been lighting both at once when the player could afford neither.

Also shipped a visual/performance pass on the ocean and fixed a few placement-highlight and build-hint rendering bugs; no other balance impact.

---

## Session 7 — Training dummies drop gold
**2026‑09‑08** · **First-hand**

**Built:** destroying a training dummy now drops a 1-gold coin, like a killed enemy. Level 1's starting gold went from 30 to 38 to cover it.

**Decision:** dummies drop gold so the first thing the player destroys teaches the game's core rule — kill something, it drops gold — instead of that lesson landing silently on wave 1's first casualty.

---

## Session 8 — Rising cost on archer towers and barricades
**2026‑09‑08** · **First-hand**

**Built:** the archer tower and the barricade now cost 10 gold more for each one already alive on the field (the 4th archer tower costs 15 + 30 = 45, not a flat 15). The refund on selling one reflects what was actually paid, not the listed base price. Barricade's base cost dropped from 10 to 5 to compensate for it now climbing too.

**Decision:** priced these two rising instead of flat, for two reasons. First, a flat price makes "cover every open tile with the cheapest option" the dominant strategy, which is both a cluttered, less readable island and a build phase with nothing left to decide once that tiling is done. Second, a rising price nudges the player toward upgrading what is already down — the more interesting tier-2 and tier-3 towers — instead of buying more of the same tier-1 building.

---

## Where things stand / what's next

**Next, in priority order:**
1. **Play level 1 start to finish.** No session has — recent tuning (starting gold, dummy count, build costs) has only been verified by forcing game state, never by playing through in order.
2. **Teach the tower upgrade menu.** Ten of twelve tower types are effectively unreachable — biggest gap in the game.
3. Music is specced (Celtic maritime folk, brighter for building, darker for combat) but not made or added.
