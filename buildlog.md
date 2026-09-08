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
- A king with a bow defends a small island from raiders who arrive by boat. Towers do most of the killing; the player covers the gaps the towers cannot reach.
- References: **Bad North** (the small island viewed as a diorama, a camera you can rotate, boats you can see coming), **Thronefall** (the build-then-fight rhythm, and controlling a single hero rather than a cursor).
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
- **A tower is bought once and never costs anything again.** Between waves, every tower is repaired for free and comes back at whatever upgrade level it had reached — otherwise upgrading would be a waste of money and nobody would do it.
- Selling a tower refunds 50% of everything spent on it, including upgrades.

### Controls
- Designed for a phone held upright.
- **Tapping the ground moves the king.** That is the default meaning of a tap everywhere in the game.
- **Building takes three steps on purpose: arm, propose, confirm.** First you tap a tower on the build bar, which "arms" it. Now a tap on the ground proposes a spot and shows a preview instead of moving the king. A separate confirm button spends the gold, so nothing is ever bought by a single mis-tap.
- **Placing the castle works the same way** — until you press the castle button, tapping the ground just moves the king.
- **Camera:** rotate by dragging, zoom with buttons. It follows the king, easing toward him rather than snapping.
  - The camera uses an **orthographic** projection, meaning objects stay the same size no matter how far away they are. This is deliberate: with a normal perspective camera, rotating the view would make the island's raised levels look slanted and hard to read.
  - Dragging rotates exactly as far as your finger moves, with no smoothing — smoothing was tried and felt like input lag. The rotate *buttons* do ease, because there is no finger to keep up with.

### Art direction
Every visual decision serves two goals: **run smoothly on a phone, and stay readable at this small scale.**

- **Flat-shaded low-poly:** simple shapes, no textures, each face a single solid colour.
- **No shadows.** Instead, each object sits on a small soft dark patch directly underneath it, so it reads as touching the ground rather than floating.
- **The lighting is a soft, even glow coming from all directions at once**, rather than one strong sun. That is what keeps the vertical cliff faces from going nearly black and the white stone reading as stone.
  - **The trade-off, worth knowing before you fight it:** even light makes a gently sloped surface look almost identical to a flat one. If you want the player to *see* a bump in the ground, you have to paint the shading into the model's colours by hand.
- **Animate size, never transparency.** When something appears or disappears — the surf line on the shore, a wave crest out at sea — it grows from nothing and shrinks back to nothing. Keeping everything opaque avoids the muddiness of stacked see-through layers.
- **All scene colours live in one file** (`src/render/palette.js`). Strong saturated colours are reserved for the king and his banners so the player's eye finds them instantly. The environment never uses red.
- **The water plane doubles as the sky** — one large sheet carrying a top-to-bottom gradient that covers the whole screen.
- **During a wave the scene shifts toward evening by changing colour only**, with every light staying exactly as bright as it was in daylight. See Sessions 2–4 for why.
- **The game checks how capable the device is at startup** and quietly reduces resolution, smoothing, and decorative animation on weaker phones.

### Onboarding (level 1 only)
The opening teaches the game by unlocking things in order. Each step waits for a real game condition rather than playing a fixed script, so a player who does things in an unusual order still gets through:

1. The king lands on the beach.
2. He climbs the stairs to the raised part of the island.
3. He destroys both training dummies standing up there.
4. Only then does the "place your castle" prompt appear.
5. The player places the castle, then is guided to build one archer tower.
6. Wave 1 begins.

- **The castle prompt requires two things at once:** the king on the upper level *and* both dummies destroyed. Both have to be re-checked continuously — see Session 5, problem 2.
- **Training dummies stay destroyed**, unlike every other structure, which is repaired for free between waves. Otherwise they would pop back up in the middle of the island for the rest of the level.
- **The barricade is hidden until after wave 1**, so the first build phase only has one thing to teach, and it appears at the same moment as the message explaining it.
- **Tutorial messages share a single popup and wait in a queue.** Anything unlocked by a message must also unlock if the player skips ahead, or a fast player loses that feature permanently.
- **Still not taught, and known:** tower upgrades and the radial menu (the biggest gap — ten of the twelve tower types are only reachable through it), picking up coins, that the build phase has no timer, what happens when the hero dies, and that the hero can jump off cliffs.

---

# PART 2 — Session log

## Session 1 — Diorama art pass and performance
**2026‑08‑29** (commit `8200bc3` "first") · *Game visual improvements, Bad North…* · **First-hand**

This session worked on a standalone island scene — a visual mock-up with no gameplay in it yet. The twelve files it produced were later moved into `src/render/`, which is still the project's layout today.

**What was built:** a visual pass to match Bad North's readable low-poly look; a performance improvement that took the scene from 582 separate drawing instructions down to 20; two new tower models; and the island grown from 8×8 to 10×10 tiles.

**Key decisions:**
- **Merge the scenery into a few combined objects rather than simplifying the models.** Every time the graphics card is told to draw something separately it costs time, so 500 small objects is slower than one large one with the same number of triangles. This set the performance approach the project still uses.
- **No shadows, treated as a firm rule** rather than something to work around. It has held for the whole project.

**Biggest problem: the cape was mathematically a flat sheet.** It was reported as "looks stiff instead of curving over his shoulders." The cause was one line: the code used the horizontal position value to set the left-right coordinate but never used it for the depth coordinate, so every point at the same height sat at the same depth — a flat vertical sheet that just got wider as it fell. No amount of added wrinkle detail would have fixed that. It was rebuilt so each row curves around the body.

**A pivot that went wrong:** I desaturated the palette all the way toward Bad North's muted look, decided it had gone too far, and tried to land halfway by blending each colour 50/50 with the original. That worked for solid colours like grass and stone, but **failed completely on the sky gradient** — averaging a warm pale bottom against a saturated cyan top pulled both ends toward the same tone, flattening the gradient into one colour. The fix was to keep the top-to-bottom spread that makes it read as sky and change only its hue and saturation.

**What I learned:** when something *looks* wrong, check the maths before adjusting the art — the cape problem looked like a materials issue and was a missing variable. A constraint you just introduced becomes the one you fight next: switching to soft even lighting fixed the cliff faces and immediately made gentle slopes invisible. And blending two things halfway only makes sense when they are the same kind of thing.

**Where it stood:** a 10×10 island running at 60fps. There was no game yet — only a scene to look at.

---

## Sessions 2–4 — Spec, tooling, and visual polish
**~2026‑08‑30 → 09‑05** · *Hero-td-prototype-tdd game expansion* / *Level setup file storage* / *Game lighting and colors* · **Reconstructed from commits, low confidence**

These three sessions were exploration and polish, aimed at the same two goals as the rest of the art work: running smoothly on a phone, and staying readable at this scale. Kept short here because they are reconstructed from commit history rather than remembered.

**What landed, based on the code:**
- **The design document** grew into the roughly 900-line spec that exists now. It added checks that run when a level loads, so a badly built level fails immediately with a clear message instead of breaking halfway through a wave.
- **Level authoring tools.** All level data moved into one file, and a browser-based level editor was added so levels can be drawn and saved rather than typed by hand.
- **Lighting and colour**, plus model fixes — including both bows having been built rotated ninety degrees. Two separately built models sharing one error usually means a single wrong assumption applied twice, so it is worth checking sibling models whenever one turns out wrong.

**The decision worth carrying forward** is the evening lighting. The first attempt made the scene dimmer: it lowered the main light, raised the darkening at the screen edges, and reduced colour saturation. The result *"read as haze rather than as evening"* — it looked like the screen was broken, not like dusk was falling. The fix was to keep every light at exactly its daytime brightness and change only the colour. The comment in the file is blunt about it: *"That is not laziness, it is the whole fix."* Worth remembering because the wrong approach was the obvious one — dimming the lights is what anyone would try first.

**What did not work:** the design document stopped matching the code, starting here. Its wave counts and its claim that the project is a "single-file build" were never updated. By Session 6 I had to check the actual wave counts in the code because the document was wrong. There is also a visible back-and-forth in the commits — "polygon increase" one day, "fewer grass polygons" the next.

---

## Session 5 — Dummy rebuild, the frozen-arrow bug, onboarding audit
**2026‑09‑06** (commit `b380c35`) · *Training dummy visuals and arrow fix* · **First-hand**

**What was built:** the training dummy remodelled, with a death animation where it topples over and sinks into the ground; a one-line fix for arrows freezing in mid-air; the castle prompt actually appearing when it should; dummies excluded from the free repair between waves; a full audit of the level 1 tutorial, which found four features that were completely broken; a queue so tutorial messages stop overlapping; the coin collection sweep slowed to half speed; an announcement when barricades unlock; and a health bar over the king when he is hurt.

**Key decisions:**
- **Training dummies stay destroyed.** The free repair between waves exists so the player never loses towers they paid for, but applying it to the dummies would stand the practice targets back up every build phase — including the one the player just destroyed to earn the castle.
- **Reveal the barricade button at the same moment as the message explaining it**, rather than when the phase changes. That makes a button unlock depend on a tutorial message, so if the player presses READY early, every pending unlock has to be applied anyway. Otherwise a fast player would lose barricades for the entire level.
- **Measure against the model, not against a screenshot.** Two things this session were positioned by eye and both were wrong: the dummy ended up taller than the king, which made it read as a person guarding the island rather than as equipment, and the health bar floated a full body-length above his head. Both are now calculated from the model itself.

**Biggest problems:**
1. **Arrows froze in mid-air, and it was not an arrow problem.** The report was that arrows got stuck when shooting at the dummies, which points straight at the code handling flight paths. Before changing anything, I printed the list of arrows currently in flight: 17 of them, every one marked "flying", every one with zero time elapsed, every one sitting at the exact spot it was fired from. Nothing was moving them. The cause was that the game only advanced projectiles during a wave — during the build phase it moved the hero, so he aimed and fired, but never advanced anything he had fired.
2. **The castle prompt never appeared, because a correct condition was checked at the wrong moment.** The condition itself was right. But the code that re-checked it only ran when the king's *level* changed, and the dummies stand on the upper level — so the king's level always changed first, and the last dummy dying went unnoticed. It only surfaced now because moving a dummy one tile changed the order the two halves finished in.
3. **Four tutorial features were completely dead, and nothing reported an error.** Two buttons were being looked up incorrectly and never found, so the barricade hold and the archer button's pulse did not exist. The "NEXT ATTACK" caption could never appear, because a cleanup routine hid it every frame in a way that overruled the code meant to show it. A timing value was set so that the branch depending on it could never run. And a click handler had been accidentally absorbed into a comment, so the restart-wave button did nothing. In every case the code was written defensively enough that nothing crashed, which is exactly why nobody noticed.
4. **I introduced a bug in my own fix and caught it with my own instrument.** The new message queue advanced to the next message the moment the previous one was *displayed* rather than when it finished, so one message blanked out mid-sentence. I only noticed because I was logging what the page actually showed over time instead of assuming the fix worked.

**What I learned:** look at the real data before forming a theory about the cause — in both the frozen arrows and the castle prompt, the symptom pointed at the wrong file and the data pointed at the right one straight away. And a feature that fails silently is worse than one that crashes; four of them had been broken for an unknown length of time with no sign.

**Handed forward:** the tutorial gaps now listed in Part 1. The largest by far is that tower upgrades are never taught — ten of the twelve tower types are only reachable through a menu that opens when you tap an existing tower, and nothing tells the player that tapping a tower does anything.

---

## Session 6 — Ocean waves, onboarding polish, placement colours
**2026‑09‑07** · *Ocean waves visual performance* · **First-hand**

**What was built:** wave crests on the open ocean — twenty small pointed shapes that rise, spread, shrink away, and reappear somewhere else. Plus tutorial changes: instructional text made 2px larger, the "ATTACK" label removed from over the dummies, level 1's starting gold reduced from 50 to 30, a glow that moves from the archer button to the READY button once you can no longer afford another tower, a shake-and-red-flash when you tap a button you cannot afford, and the build hint changed from the movement marker to a square outline on the suggested tile.

**Key decisions:**
- **Build the waves as actual shapes rather than as a pattern drawn across the water.** The alternative was to calculate the wave pattern for every pixel of the ocean — and the water covers the entire screen, roughly 5.2 million pixels recalculated every frame. Twenty small merged shapes cost about a twentieth of that, and they allow a deliberately pointed wave silhouette the pixel-based approach cannot produce.
- **Work out valid wave positions once, at startup.** Every possible spot is checked against the coastline before play begins, so a reappearing wave picks from a pre-approved list. Checking during play would risk a stutter, or worse, failing and putting a wave on the beach.
- **The ring-and-arrow marker means "go here" and nothing else.** The build hint was using it too, so the same symbol meant two different things. It became a square outline on the target tile instead.

**Biggest problems:**
1. **A glow that lit up two buttons at once.** I wrote the archer button's glow condition as "the old tutorial condition OR the new affordability condition", which felt like the safe, additive change. Testing across seven game states showed that with no towers built and no gold, both the archer button and the READY button glowed — pointing at a purchase the player could not make. The fix was to make the two conditions mutually exclusive, decided purely by whether another tower is affordable.
2. **A half-tile error that only became visible once the marker got more precise.** The code that picks a suggested build spot measured outward from the castle's stored position, which is the *centre* of its 2×2 footprint — so every suggestion landed halfway between tiles. The old floating ring hovered between four tiles and nobody noticed; a square outline has to sit on one tile, so the error became obvious immediately.
3. **A colour problem where my first diagnosis was wrong.** The report was that the valid-placement highlight looked red against the grass, like it meant "no". I first treated this as a bad colour choice. Inspecting the actual scene found three separate see-through layers stacked on the same tile:
   - The dark outline was a solid square drawn *on top of* the coloured fill, not a hollow border, so half of the fill colour was mixed with near-black.
   - The tile under the cursor was being painted red by the tower's range overlay, because a tower cannot shoot the square it stands on and that counts as a "dead zone".
   - The "invalid" colour was so faint that it came out olive rather than red.

   Valid and invalid both ended up nearly the same dark brown, so the two states were telling the player the same thing. All three layers were fixed.

**What I learned:** judge a technical option against this project's actual bottleneck rather than in general — the pixel-based wave field is the more elegant solution and the wrong one here. Calculating what stacked colours actually produce found the highlight bug in minutes, where looking harder at the screen would not have. And checking that code works is not the same as playing the game; I confirmed a lot of behaviour this session and played none of it.

---

## Where things stand / what's next

**Working:** all Session 6 changes are in and confirmed running, with no errors on startup. The wave system was tested over 400 simulated seconds on all three levels — no wave ever appeared on the island, and no two waves ever overlapped.

**Next, in priority order:**
1. **Play level 1 from start to finish.** No session in this log has done this. The button glow, the delayed build hint, and the reduced starting gold were all tested by forcing the game into the right state, never by playing through them in order.
2. **Teach the tower upgrade menu.** Ten of the twelve tower types are effectively unreachable because nothing hints the menu exists. This is the biggest gap in the game.
3. **Update the design document to match the code** — wave counts, the "single-file build" claim, and the enemy list.
4. Music has been specced (Celtic maritime folk, brighter for building and darker for combat, 96 and 144 BPM) but has not been made or added. The game currently has synthesized sound effects only.
5. Commit the current working folder, which still holds all of Session 6.
