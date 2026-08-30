# Hero Tower Defense — Technical Design Document

Prototype. Web, mobile-first portrait, Three.js, single-file build.

---

## 1. Concept

You are a king with a bow, defending a small island from seaborne raiders. Towers do the bulk of the killing. You plug the holes. Boats approach visibly, you get time to reposition, then the wave lands.

Reference points: Bad North for the island diorama, rotatable camera, boat telegraphing, and readable low-poly look. Thronefall for the build phase / combat phase loop and the single controllable hero.

Scope: 3 levels, 2 tower lines with 3 tiers each, 3 enemy types, one hero. No meta-progression, no unlocks, no save system. Each level is a standalone island. Nothing carries over between levels.

---

## 2. Core loop

```
Level start
	|- Castle placement
	|    |- king places the mandatory 2x2 castle
	|    +- no wave can start until placement is valid
	|- Build phase (untimed)
  |    |- place towers, upgrade towers, take down towers
  |    |- hero moves freely
  |    +- player presses READY
  |- Wave
  |    |- boats spawn on open water, steer toward island
   |    |- ~10s approach, passengers are shootable aboard invulnerable boats
   |    |- boats land, enemies path toward and attack the castle
  |    |- combat until all enemies dead
  |    +- gold auto-collects to hero
  |- Back to build phase
  +- Repeat for N waves
Level complete
```

Wave counts: Level 1 = 6, Level 2 = 8, Level 3 = 10.

### Between waves
- All towers fully repaired free, including destroyed ones. They return at full HP on their original tile, **at their full upgrade tier**.
- The castle is repaired to full HP. It is never rebuilt if destroyed: destruction ends the wave immediately.
- Towers can be taken down for a 50% refund of total invested gold, not base cost.
- Houses rebuilt automatically.
- Hero returns to full HP, revive counter resets.
- Uncollected gold flies to the hero.

Towers are a one-time capital purchase. The economy is about how many you can afford, where they sit, and how deep you upgrade. Never upkeep.

Free repair must apply at every tier. If an upgraded tower returned as a T1, upgrading would be a trap and nobody would do it.

---

## 3. Terrain

### Grid
**All levels are 10x10 tiles.** Some tiles are water, so usable land is smaller. Tiles are physically large: many units pack into a single tile.

10x10 is the size the art was built and tuned against, and the camera framing derives from it (`FRAME = N * TILE`), so it is by far the cheapest size to keep. The reference island fills 68 of its 100 tiles with land; minus the 2x2 castle, ramps, houses and the shore ring that leaves roughly 51 buildable spots.

That is a *loose* budget, not a tight one. The constraint on how much a player builds is gold, never space, and the player will never come close to filling the island. If placement starts feeling unconstrained in playtest, take land away by widening water coverage on that level rather than shrinking the grid.

```js
{
  x, z,          // grid coords
  height,        // 0 = water, 1..3 = land tiers
  type,          // WATER | LAND | RAMP | SHORE
  occupant,      // null | TowerRef | HouseRef | CastleRef
  rampDir,       // for RAMP: which neighbor it ascends toward
  buildable      // derived: type === LAND && occupant === null
}
```

### A walker remembers its tier; it does not sample the ground

**Every walking thing carries a `tier`, and its height comes from that.** Not
from the terrain under it. The tier changes in exactly two places -- traversing a
ramp, and landing a cliff jump -- and nowhere else.

This is a correctness rule, not an optimisation. The height of a continuous
position has to come from the tile it rounds to, and near a corner it rounds to a
NEIGHBOUR: stand on the corner of a plateau and the nearest tile centre is the
one below, so the figure drops a full tier while standing still and pops back
when it shifts a few centimetres. Widening the diagonal crossing corridor helped
where two tiles were formally linked and did nothing at any other corner, because
the problem was never which corners are walkable. It was asking the terrain a
question the walker already knew the answer to.

`board.walkElevation(x, z, tier, onRamp)` is the one implementation, and it is
pure -- the caller owns the state and assigns what comes back. `groundYAt` stays
as the sampling version and is correct for anything asking about a POINT rather
than about a walker: where an arrow lands, where a marker goes.

Measured after the change: 92 of 96 plateau-corner positions hold their height
exactly, and the four that move are inside a ramp corridor, which is the one
place a walker is legitimately between two tiers. Across 49,445 unit-frames of
real waves the worst deviation from the remembered tier was 0.0000.

### Enemies are long-bodied, short-legged and braced

All three enemy types share a proportion that is deliberately **not human**:
a tall torso over stumpy legs, with a fixed knee bend and an outward thigh splay.
Two reasons. The game is watched from a high angle, where legs are mostly hidden
behind the body and the torso does nearly all the silhouette work -- so length
spent on the torso is length that shows. And a braced, slightly crouched stance
reads as men who expect to be hit, which is what separates a raider from a
pedestrian at a glance.

The legs are two segments -- `hip -> thigh -> knee -> shin` -- and both the knee
bend and the thigh splay live on their **own groups**, not on the hip. This is
the third time that rule has had to be applied (the torso stoop and the sword
counter-pitch were the others): `applyGait` and `applyDeathPose` assign
`hips[k].rotation` *absolutely*, so any stance stored on the hip is erased on the
first animated frame. **Anything static that must survive animation needs a group
of its own between the animated joint and the mesh.**

`hipY` for each type is `(thigh + shin * cos(kneeBend)) * cos(splay)` -- the
height a bent, splayed leg actually reaches, so the feet land exactly on the
ground. Verified to within 0.0004 world units for all three types. **Change
either angle and every `hipY` has to be recomputed**; there is nothing at
runtime that will catch it, the figures will simply hover or sink.

The thigh is deliberately *not* tilted forward to put the foot back under the
hip. It would cost another group, and `LEG_SWING` is 0.50 rad peak, so a base
tilt of any useful size makes the walk permanently lead with one direction.
Bending at the knee alone leaves the foot ~0.017 behind the hip, which is under a
centimetre at world scale.

Cost: one leg mesh became two, so +2 InstancedMeshes per type, +6 overall.

### The raiders run; the king strides

`applyGait` takes a **profile** rather than reading the tuning constants
directly, and there are two: `anim.run` for enemies and `anim.stride` for the
king. They exist because the two rigs are not the same shape -- the king has no
knees, and the raiders' wider leg swing on a knee-less rig would only scissor a
straight leg further, which is exactly the mannequin-sliding look the knees were
added to break. Passing a profile rather than branching inside the animator
means neither can drift into the other by accident.

The run profile is deliberately past what a real body does. Raiders are read at
twenty-odd pixels from a high angle, where a truthful gait is indistinguishable
from standing still and sliding.

**Knees are what make it a run.** Flexion is added only over the recovery half of
the cycle -- the trailing-to-leading transit -- and peaks as the leg passes under
the body. For leg 0 that transit runs `gait` pi/2 to 3pi/2, whose midpoint is
where `cos(gait) = -1`, so `max(0, -cos(gait))` is exactly the window and exactly
the shape; leg 1 is the same window half a cycle away. Clamping at zero leaves
the stance half rigid, which is what a leg carrying weight does. Verified: at
each crossing one leg is fully folded and the other fully straight, and at full
split neither is.

**Two bugs in the bounce, both found on paper rather than on screen.**

1. *Wrong phase.* It was `(1 - cos(2 * gait))`, which peaks at full leg split --
   when the legs are most angled and the hips are at their **lowest**. It lifted
   the body at precisely the moment it should have dropped. `cos(2 * gait)` peaks
   at the passing positions, where the support leg is straight and vertical.
2. *Wrong offset.* There is **no foot IK** in this rig: a foot's height is
   whatever the hip and the leg pose put it at, so raising the body raises the
   feet with it. Simply correcting the phase to an all-positive `(1 + cos)` lifted
   the whole figure off the ground exactly when its support leg was longest --
   measured at 0.0096 world units, about 0.7 of a screen pixel, and it never
   planted at any point in the cycle. Centring the oscillation on zero drops the
   split phase by as much as it raises the passing phase, bringing the lowest
   foot to -0.001 (planted) while keeping the corrected phase. It costs nothing
   at rest because the term is scaled by `speed01`.

Measured foot contact over a full cycle after the fix: grunt -0.0010, archer
+0.0001, brute +0.0034 world units, against peak foot lifts of 0.033 to 0.062.

**The general rule this is the third instance of:** every static pose that must
survive animation needs its own group between the animated joint and the mesh
(torso stoop, knee bend, thigh splay), and every *runtime* offset that must not
disturb the idle pose needs scaling by `speed01`. `applyGait` writes joint
rotations absolutely; nothing it touches can hold a resting value.

**Cadence is decoupled from speed.** `anim.ENEMY_CADENCE` multiplies the rate the
gait phase advances without touching the distance covered, so raiders' legs cycle
three times faster than their movement implies -- scrambling up a beach rather
than marching. The hero has the same lever in `hero.walkAnimRate`; gait still
advances with distance travelled and never with wall-clock time, so the trick
survives frame-rate changes and pausing.

The knock-on is audio, and it turned out to be already handled. Footfall events
come off gait phase, so a grunt went from 2.4 to 7.1 footfalls a second and forty
ashore from roughly 95 to 285 triggers a second. The footstep voice is capped at
3 with a 0.05s duration, so at most about sixty a second can ever sound and the
rest are dropped quietly by `claim()`. Section 19 authored it as *texture, not an
event* for precisely this reason, and that decision paid for a change made long
afterwards.

**Enemies sit slightly proud of the ground** (`anim.ENEMY_LIFT`, applied to the
render root only). The contact blob deliberately does **not** move with it -- a
shadow that stays on the floor under a lifted figure is the whole effect. Feet
now bottom out 0.7 to 1.1 screen pixels above the ground rather than planting,
which is intentional here and not the accidental float described above; the
difference is that this one is a named constant rather than a side effect of a
phase error.

Measured, at play size: body bob 2.1 to 2.5 pixels peak-to-peak (up from 1.3 to
1.5), peak foot lift 0.057 to 0.086 world units.

### Enemy silhouettes are provisional where they are shared

`TYPES.knight` is an explicit alias of the grunt. `build` and `scaleOf` already
fall back to the grunt for any unrecognised type, so the alias changes nothing
today -- it exists to record that the sameness is deliberate and temporary, and
to be the single line replaced when the knight earns its own shape.

**No `knight` exists anywhere else in the project yet** -- not in
`config.enemies`, not in any wave table. The alias is forward-looking only.

One thing to fix at that point: `units.js` caches an instancing kit per **type
string**, so two types sharing geometry still allocate two full sets of
`InstancedMesh`es. A knight shipping before it has a distinct model would double
its draw calls for no visual difference.

### A black face under a silver helm

Every enemy has the same head: a **sphere in pure black** under a **light silver
spectacle helm** of the Gjermundbu type -- a domed skullcap with an ocular guard
hung below its rim, two eye openings and a nasal between them.

The face is pure `#000000`, not a dark grey. It takes no light at all, so it
stays a void from every angle instead of lightening as a unit turns -- which is
what makes the eye openings read as *holes* rather than as dark paint. The holes
are real: the ocular guard is an extruded shape with two circles punched through
it, and what shows through them is the black ball behind.

Geometry verified rather than eyeballed, at a nominal head diameter of 1.0:

| point | clear of the dome? | proud of the face? |
|---|---|---|
| eye centre | yes, below the rim | +0.019 |
| eye bottom | yes | +0.007 |
| eye top | overlapped by the rim, top 7% | +0.046 |
| nasal tip | yes | +0.012 |
| plate top edge | tucked behind the dome | +0.025 |

The dome rim overhanging the top sliver of each opening is wanted, not a defect:
it is the brow. Nothing is buried in the head, and the guard's outer corners
flare past the dome by 0.118 of a head diameter -- under a pixel at play size,
and roughly what a real spectacle guard does at the cheekbones.

**Two things had to move when the box became a ball.** A box sitting flush on the
body top is a clean butt joint; a sphere touching a flat top meets it at a single
tangent point and leaves a notch of daylight all the way round the neck -- so
every head is now sunk about 0.15 of its diameter into the shoulders. And the
grunt's head was enlarged from 0.105 to 0.122: that number was chosen for a small
box under a *wide overhanging box helmet*, and with the overhang gone it left a
pin head on a very wide body.

**Three consequences worth deciding on, none of them settled here:**

1. **Enemies are no longer near-black**, which is what this document says they
   are. The helm is the brightest thing on the figure. The silver is a hair warm
   of neutral rather than the cold blue-grey a helmet wants to be, which keeps it
   on the gameplay side of the warm/cool split -- but the "near-black enemies"
   line above is now describing the *body* only.
2. **The shield boss lost its job, and the shield went with it.** The boss was
   introduced as "one bright speck on an otherwise near-black figure", the mark
   that identified a grunt at twenty pixels; the helm took that role, leaving two
   draw calls paying for a mark that no longer marked anything. Both are gone
   (`shield: 0` -- the build path is intact and a radius brings them back).
   Grunt/archer/brute separation now rests entirely on body width, the bow, and
   size.
3. **The brute has lost its bare head**, which was its stated silhouette cue. It
   is still half again the size of the others, which was always the stronger half
   of that read.

Cost: +4 InstancedMeshes overall (head, dome and guard is three meshes where the
grunt and archer had two and the brute had one).

### The grunt winds up, and throws fire at buildings

**Damage no longer lands on the tick the cooldown expires.** A grunt's blow is
wound up first (`attackWindup`) and connects partway through, then follows
through (`attackRecovery`). A hit that arrives before the arm has moved is the
reason instant melee reads as nothing happening.

**The cooldown still starts at the windup, not at the landing**, so damage per
second is unchanged -- only its phase moves, by one windup, once, at the start of
an engagement. Measured: swings start every 0.90s against a configured
`attackInterval` of 0.90.

The swing runs on its own clock once started, deliberately independent of
targeting. A windup that could be cancelled by its target dying would let a
player dodge damage by killing something else, which is not a mechanic anyone
asked for; instead the blow completes and whiffs.

**Against a BUILDING the grunt throws a molotov instead of swinging.** Same
cooldown, same damage, same reach -- *the range is deliberately not extended*.
Letting grunts hit walls from further away would change how every chokepoint on
every level plays; this is presentation, not balance. Damage rides the projectile,
so a building takes it when the bottle arrives (a minimum 0.18s flight even at
contact range, which `leadTarget` already guaranteed).

A molotov is spliced on impact rather than embedding. Arrows earn an afterlife --
they stick in the target, plant in the ground, or overtravel -- but a bottle is
glass and burning rag, and leaving one lodged in a wall as a glowing box was the
one way this could have looked broken. It was, until it was caught.

Since these units have no arm meshes, the swing is carried by three things that
are visible: the weapon on its shoulder pivot, the torso twisting against it, and
the whole body lunging into the blow. The pose reads the simulation's swing
clock, so the animation and the damage cannot drift apart.

### Buildings burn instead of wearing a gauge

**Only the castle keeps a health bar, and it is green.** Everything else reports
its health by burning: square embers in gameplay red, rising and shrinking, more
of them the more hurt the building. It reads at a glance from any zoom, needs no
billboarded UI cluttering the island, and is diegetic -- a burning house is
information and set dressing at once. The one bar that survives means something
precisely because it is the only one: the objective is the only thing whose exact
HP is worth that much screen space.

**No per-ember state.** Each ember is a pure function of (structure id, index,
world clock), so nothing is allocated while a wave burns, nothing leaks when a
building dies mid-life, and the whole pool is one instanced draw. Pausing freezes
them, because `world.time` stops.

They shrink to nothing rather than fading, because this Three build cannot vary
opacity per instance -- the same `instanceColor` gap noted elsewhere. Scale is
the only channel available, and squares vanishing to a point suits the faceted
look better than a soft fade anyway.

**The taper shape decides the apparent size of the effect as much as the size
constant does.** The first version tapered as `(1 - p)^2`, whose average value is
a THIRD: embers nominally 0.115 across were typically drawn at 0.04, about three
pixels -- not an indicator, grit on the lens. Holding full size for the first
third and then shrinking linearly fixed it, and the size constant went up
alongside.

Verified: four buildings staged at 25/45/55/75% damage produced exactly
`round(damage x max)` embers each, one visible bar, fill colour `#49c96a`. A full
wave peaked at 17 embers and held 60fps.

### Armless, and the legs are drawn longer than they are

**Enemies have no arm meshes.** The shoulder pivots remain, so the animator still
swings them and the weapon parented to the right-hand one still swings and still
damps -- a raider carries a floating sword, bow or club with nothing joining it
to the body. That is the intent, not an artefact: without an arm there is no hand
for a weapon to sit in, so it hangs where the hand would have been.

It is a flag (`SHOW_ARMS`), not a deletion, and `arm`/`armCant` stay in every
type. Arms return by flipping one boolean.

**The grunt's leg meshes are drawn longer than the segments they represent.** The
thigh keeps its top at the hip and reaches *down* past the knee; the shin keeps
its base at the foot and reaches *up* past the knee. They grow toward each other
and overlap, which fills the wedge of daylight a bent knee opens on its outside
edge, and reads as fuller, longer legs.

**Nothing about the skeleton moves.** `legOverlap` is consumed only by
`bevelBox` dimensions; the hip, the knee and the foot are placed from the
unchanged segment lengths, so the gait, the foot contact and every `hipY`
derivation are untouched by construction rather than by luck. Verified: drawn
leg 0.141 against a 0.119 skeleton, and hip-to-foot reach still 0.11587 against
a `hipY` of 0.116.

The one thing that could have gone wrong does not: the shin's extension rotates
with the knee, so at peak run flexion its top corner swings 0.0095 behind the
joint against a thigh half-depth of 0.0415 -- comfortably inside, no poke-through
at any point in the cycle.

**These three changes together cut the enemy rigs from 42 InstancedMeshes to 34**
(-6 arms, -2 shield and boss), which is a third of the way back from everything
the helm, the knees and the pauldrons added.

### Raiders are warm-dark, not blue-dark

`palette.enemy` moved from `#2e2f35` to `#3a2b2e` -- the same darkness, a red
hue instead of a blue one, with limb and armour tones warmed to match. This is a
correction rather than a preference: section 15 already assigns **warm and dark**
to gameplay and forbids the environment any red at all, and the old cool
near-black was quietly on the wrong side of its own rule. Luminance is matched to
within a point, so enemies read exactly as dark against grass as they did.

### Nobody stands inside a cliff

Every walker -- the king and every enemy alike -- is held to `board.canStandOn(x, z, tier)`, never to `isWalkable`. The distinction is the whole rule: **a cliff face is ground.** `isWalkable` only asks whether there is land under the rounded tile, so it happily admits a position inside the side of a rise. A walker that gets there keeps the height of the tier it came from, which puts it *inside the rock* -- invisible, underground, and still alive and pathing.

On level one, 437 of 1034 sampled walkable positions are cliff interiors for a tier-1 walker. That is the surface area this predicate covers, and it is not an edge case.

The hero got `canStandOn` when he hit this; the enemies were left on the weaker test and hit it too, through separation shoving them into a rise. Both now use the same predicate, and separation judges each unit on **its own** tier -- two units shouldering each other across a ledge are not standing on the same ground.

**Order is load-bearing: tier, then separation, then height.**

```
walkElevation   ->  promotes the tier of anything that just left a ramp
separation      ->  clamps, tier-aware, against that fresh tier
walkElevation   ->  final height, since separation may have moved it
```

Clamping before resolving elevation tests the tile at the *top* of a ramp against the tier at the *bottom*, rejects it, and pins the walker to the ramp forever. That is not hypothetical -- the hero's clamp was written the wrong way round first and did exactly this.

**The failure mode to watch for when tightening any of this** is not units in cliffs, it is units that stop: a walker rejected every frame stands still, stays alive, and holds the wave open forever (see TDD 6 -- never allow a state where a unit has no valid action). Hence slide-before-revert everywhere, and the last-resort snap to nearest land, which must also adopt that tile's tier or it trades drowning for burial.

### The hero is the only mover without a separation pass

Units are clamped every frame by `separation.resolve`; the hero is not in
`world.units`, so nothing constrained where he ended a frame at all. He walked
bodily into cliffs -- keeping his own height, so he was inside the rock -- and
from then on every question answered by ROUNDING his position reported him a
tier above where he was. Including whether the tile ahead was a drop, which
started cliff jumps from ledges he was never standing on.

Three parts, and they only work together:

- `board.canStandOn(x, z, tier)` -- strictly stronger than `isWalkable`, which
  only asks whether there is ground, and a cliff face is ground. A crossing may
  pass OVER a lower shoulder, which is what crossings are for; it may not pass
  INTO a higher one, which is standing inside rock.
- A clamp on the hero each step, sliding before reverting exactly as separation
  does for units.
- `cliffNext` and the jump's start height read `hero.tier` rather than the tile
  he rounds to. The tier decides how high he is drawn, so it should decide
  whether the step in front of him is a drop.

**Order matters, and getting it wrong pins him to the stairs.** Elevation has to
resolve BEFORE the clamp: stepping off the top of a ramp is the moment his tier
changes and `walkElevation` is what notices, so clamping first tests the new tile
against the tier he held at the BOTTOM of the stairs, rejects it, and he can
never leave the ramp. That is a real regression this fix shipped with for one
iteration.

Measured on the reproduction -- starting hard against a wall, 104 runs: 1,119
frames inside higher terrain and 627 cliff jumps from the wrong tier, both to
zero, with nobody stuck against a wall and arrivals up from 76 to 96.

Units still have the milder version of this (0.7% of frames), because their
`legal()` test is land-only. They never cliff-jump, so it is cosmetic.

### Elevation rules
- Height 0 is water. 1, 2, 3 are land tiers.
- Every elevation change is a cliff, impassable to ground units.
- The only way up is a **ramp tile** connecting tier N to N+1.
- Ramps are not buildable. Players defend beside chokepoints rather than sealing them.
- The hero can **jump down** any cliff, any number of tiers, downward only. Enemies cannot. This is his core mobility advantage and the reason he reads as a king rather than a mobile archer tower.

### Level authoring
Hand-authored, not procedural. Three tuned 10x10 levels beat any generator at this scale.

A level is a height array, plus an explicit list of ramp tile-pairs, plus author-placed houses:

```js
{
  heights: [ [0,0,0,1,1,1,0,0,0,0], ... ],   // 0 = water, 1..3 = land tier
  ramps:   [ [[4,7],[4,6]], [[2,6],[2,5]] ], // [[lowI,lowJ],[highI,highJ]]
  houses:  [ [2,3], [7,5], [3,8] ]
}
```

**Ramps are explicit pairs, not inferred from a `/` glyph.** An earlier draft inferred ramp direction from neighbour heights, which is ambiguous the moment a ramp tile touches two tiers at once. Naming both ends removes the ambiguity, and makes an illegal ramp a data error you can catch by reading the file.

Validate at load and fail loudly: the two tiles must be orthogonally adjacent, and must differ by exactly one tier.

**A tier-2 tile on the waterline is coastal cliff.** A boat unloads onto the
first land tile its ray meets and section 11 will not unload above tier 1, so
such a tile is shoreline that is never landed on. Author it deliberately: it is
how a level says "not here" without spending water on it, and it shapes where a
wave can come ashore without shrinking the island.

This is only safe because the spawner enumerates rather than guesses -- see
section 11. A level may be almost entirely cliff-walled; what it may not be is
cliff-walled *everywhere*, because then there is no landing to choose and
`validate()` rejects it.

### Load-time validation
Reachability check from every shore tile to every house. If a house is unreachable, the level is broken. Catching it at load saves hours chasing phantom pathing bugs.

Everything `board.validate()` checks exists because the failure it catches is
silent at runtime: an unreachable house looks like a pathing bug, a cliff on the
waterline looks like a spawning bug, an orphaned islet looks like nothing at all
until a tower is built on it, and a level with no legal 2x2 is not discovered
until someone tries to site a castle on it. It reports every problem it found
rather than the first, and it is the reason all three levels were correct before
any of them was played.

---

## 4. Structures

### Castle
- At the start of every level, before normal tower building, the king must place one castle. It is free and mandatory. It is sited with the same arm-tap-confirm flow as every tower (see §16, "Pick, place, confirm"), armed by a single round button carrying the keep glyph. Until that button is pressed the king walks normally, so the opening beat of a level is reading the island rather than being handed a placement cursor.
- The castle occupies a 2x2 square of orthogonally adjacent `LAND` tiles. All four tiles must be empty and on the same elevation; it cannot overlap water, shore, ramps, houses, or another structure.
- The placement validator writes the same `CastleRef` into all four occupant cells and requires at least one reachable, non-castle land tile adjacent to its footprint. The player cannot place an objective enemies can never attack.
- It is a permanent objective: it cannot be upgraded, moved, taken down, or rebuilt. The four occupied tiles are never buildable while it lives.
- It has HP and automatically fires a volley of two arcing arrows at the nearest enemy with valid arc LOS, including enemies still aboard boats. It has no minimum range. Castle HP, arrow damage, range, and cooldown belong in the central tuning config.
- On destruction, end the current wave immediately and show the failure recovery UI, even if towers or houses remain.

The castle gives the king a defensible home and a fixed loss condition, while its 2x2 footprint makes initial placement a meaningful map-reading decision rather than a free extra tower.

### Houses
- Author-placed, not player-placed.
- Pay gold at the **start of each build phase**, only if they survived the previous wave. A house destroyed during a wave pays nothing that cycle but is rebuilt free.
- Have HP, occupy their tile, are valid enemy targets.

House count per level: 3 / 4 / 5. Income per surviving house: 10 gold. Placeholder numbers.

### Towers overview

Two lines, three tiers each. Tier 1 is the base. Tier 2 chooses a specialization. Tier 3 chooses a capstone within that specialization. Four endpoints per line, eight total.

Footprint is always exactly one tile at every tier. Upgrades change stats and silhouette, never occupancy.

**Visual grammar.** Across the whole tree, upgrades read the same way:
- **Wider** silhouette means more projectiles per volley
- **Taller** silhouette means more range and more HP

A player can read any tower's build at a glance without a tooltip, and you only need two mesh variants per T2 rather than eight bespoke models.

---

## 5. Archer line

### T1 Archer Tower
- Cost 40, HP 100
- **Two weak arrows per volley**, arcing trajectory
- Range 4.5 tiles, **minimum range 0.5 tiles**
- Build time 1.5s

Range 4.5 on a 10x10 island is deliberately short, well under half the map width. The T1 archer is a local defender, not area coverage. This makes the Tall upgrade's range bonus genuinely valuable rather than incremental.

**Every range in this document was authored against an 8x8 board and has been scaled by ~1.15 for 10x10, then rounded to something readable.** They are placeholders either way. What tuning must preserve is the *ordering and the gaps*, not the numbers: archer well under half the map, ballista roughly double the archer, hero between the two.

The 0.5 minimum range means it defends its own tile fine but has a small dead zone. It is not helpless up close, unlike earlier drafts.

### T2, choose one

| | **Fortified Tower** | **Ballista Tower** |
|---|---|---|
| Cost | 50 | 60 |
| HP | 100 → 220 | 100, unchanged |
| Range | 4.5, min 0.5 | 8, min 1.5 |
| Attack | Two weak arrows, arcing | One powerful bolt, near-flat |
| Melee answer | **Burning rocks** dropped on adjacent enemies, same damage as one arrow, fired **simultaneously** with the arrow volley | None. Blind inside 1.5 tiles |
| Fire rate | Unchanged | Moderately slower |

**Fortified Tower.** The simultaneous burning rocks are the important detail. The tower is never idle: it arcs at range and drops on anything that closes, both in the same tick. This preserves the archer's minimum-range character while removing the helplessness.

**Ballista Tower.** The flat trajectory is its real cost, not flavor. Arcing shots clear terrain; a flat bolt does not. A ballista on tier 1 firing at tier 3 is blocked by the cliff face where an archer tower would arc over it. It wants high ground and open water.

That gives it a natural job: boats. Seven tiles of range from an elevated shore tile, plus the elevation bonus, means it works during the approach phase before anything lands.

### T3, either path

| | **Wide** | **Tall** |
|---|---|---|
| Visual | Top platform widens, doubled firing slots | Gains a storey, narrow and high |
| Fortified | **Four arrows** per volley | Two arrows, +HP, +range |
| Ballista | **Two bolts** per volley | One bolt, +HP, +range |

Wide doubles the projectile count, not the fire rate. This keeps the ballista's slow heavy rhythm intact instead of turning it into a machine gun.

Tall's range bonus stacks with the elevation bonus. A Tall Ballista on tier 3 covers most of a 10x10 island, which makes the ramp to tier 3 the most valuable ground on the map.

Suggested names: **Garrison** / **Watchtower** off Fortified, **Twin Ballista** / **Siege Tower** off Ballista.

---

## 6. Barricade line

### T1 Barricade
- Cost 15 to 20, HP 150
- **No attack.** Pure obstacle.
- Blocks movement, absorbs hits

The barricade deals zero damage, so an archer tower is the mandatory first purchase and the barricade is what you buy alongside it. Price it low enough that it's always affordable.

### Barricade avoidance behavior

**Enemies route around barricades and other player-built structures while a castle path exists.** They are solid obstacles in the primary route calculation, so barricades still funnel a landing party instead of becoming automatic aggro sinks.

This makes barricades funneling tools rather than aggro sinks. Players lengthen an approach, force a crowd through a gap beside a spear bunker, or steer a landing party into ballista fire.

**Fallback route.** When no route to the castle exists with player-built structures included, recalculate using terrain and ramps only, ignoring tower and barricade occupancy for navigation. This is planning-only: those buildings remain physically solid. The unit will therefore stop at the first building that enters aggro range and attack it, opening the route instead of stalling or walking through it.

Never allow a state where a unit has no valid action.

### T2, choose one

| | **Bulwark** | **Spear Bunker** |
|---|---|---|
| Cost | 30 | 40 |
| HP | 150 → 450 | 150 → 220 |
| Attack | None | Spear thrust, adjacent, moderate damage |
| Special | None | Hits knock enemies back ~0.5 tiles |
| Enemy behavior | Avoided by the primary route; attacks on proximity aggro | Avoided by the primary route; attacks on proximity aggro |

Both structures are solid player-built obstacles for the initial castle route. Their combat difference is unchanged: Bulwarks reshape the route and absorb damage; Spear Bunkers kill what enters their contact range.

**Spear Bunker survivability.** Effective durability runs well above its 220 HP against packed groups, since every hit resets an attacker's approach. Against a single brute, it is just 220. That gap is the interesting part.

### T3, either branch

| | **Spikes** | **Catapult** |
|---|---|---|
| Cost | Lower | Higher |
| HP | Small increase only | Small increase only |
| Effect | Reflects damage to any enemy attacking it in melee | Lobs a large AOE projectile on a moderate cooldown |
| Range | Contact only | **Min 2 tiles, max 5.75 tiles** |

**Design concern with Spikes on the Bulwark branch.** Enemies avoid Bulwarks, so a spiked Bulwark rarely gets attacked and spikes rarely trigger. It only pays off when the player has deliberately sealed a route. Catapult will be the default pick unless you either extend spikes to damage enemies merely walking adjacent, or accept spikes as the cheap situational option for sealed layouts.

Flagged as an open item. Playtest before choosing.

**Catapult.** The 2-tile minimum means it cannot hit what is attacking it, so it needs cover. Pairing a catapult behind a bulwark is the obvious combination, and it being discoverable is a good thing.

---

## 7. Tower rules

- Build and upgrade only during build phase, both 1.5s.
- Upgrade cost is separate from build cost. A full T3 runs roughly 3 to 4x a T1.
- Takedown refunds 50% of **total invested**.
- Free auto-repair at every tier.
- Tower placement only where `type === LAND && occupant === null`. Never ramps, water, or shore. Castle placement is the explicit 2x2 exception in section 4.
- Build phase is untimed, so the 1.5s timer is feel only. Pressing READY snaps pending builds to complete.
- **Zero tower interaction during combat.** No repair, upgrade, or sell.
- Newly placed towers and the castle ease upward from beneath the terrain over roughly 1.6 seconds, shaking subtly while they rise. Large opaque, low-poly dust puffs appear progressively around the footprint during the early ascent; no new dust spawns during the final 0.4 seconds. This is presentation-only and does not delay placement, collision, or targeting. Author-placed houses do not play the effect at level load.

### Towers block movement
Towers and barricades are solid. Enemies cannot walk through or over them. Three consequences:

1. **Mazing is handled by castle-first routing and aggro.** The primary route avoids player structures; if they seal the route, the terrain-only fallback leads units into proximity aggro against the blockers.
2. **Reachability can break.** A player could ring a ramp exit. Do not forbid this. Enemies chew through the buildings they encounter, so a wall is a delay, not a seal.
3. **Recompute flow fields whenever a player structure is built or destroyed.** Its tile just became blocked or opened.

### Towers do not block line of sight
Only terrain does. Towers are solid to movement but transparent to projectiles. Otherwise dense placement blinds itself and players get punished for building what looks like a strong cluster.

### Forward-looking: directional towers
All current towers are omnidirectional. Store a `rotation` field on the tower record now and have the renderer honor it, even though nothing uses it. Retrofitting rotation into placement UI, targeting arcs, and the range overlay later is far more work than carrying an unused field.

---

## 8. Units and movement

### Freeform movement on a grid world
Terrain and tower placement are grid-based. **Units move freely in continuous space.** The grid is a navigation and building substrate, not a movement constraint.

### Two radii per unit

- **Push radius (small).** Unit-vs-unit separation only. Compact, so enemies pack densely and many fit on one tile.
- **Hit radius (large).** Incoming projectiles and melee. Generous, so shots connect reliably.

```js
{
  pushRadius: 0.18,   // tile units, compact
  hitRadius:  0.40,   // tile units, generous
}
```

The gap is a feel decision, not a bug. Tight packing makes a landing party read as a mob rather than a queue. Large hit radii make ranged combat feel responsive instead of like arrows are missing.

### Separation
Units push each other apart so they never occupy the same point. Iterative separation: for each overlapping pair, push both along the connecting axis by half the overlap. Two iterations per frame is enough at 40 units.

Structures are hard collision, not soft push. Enemy units never overlap a tower, house, or castle. The king may pass freely through Archer Towers and base Barricades; other tower types use a reduced hero-only collision footprint so he can move tightly around them, while their full footprint remains solid to enemies.

### Pathfinding
With a 10x10 grid and 40 units max, use **flow fields** rather than per-unit A*.

- On landing, build a castle flow field over terrain, ramps, and unoccupied tiles. It must treat player-built structures as solid.
- If that field cannot reach the unit, build a terrain-only castle flow field that ignores player-built structure occupancy but still respects cliffs and ramps.
- Units sample the field at their position and steer along it, blended with separation.
- Recomputed when a player structure is destroyed or built. Both rare.
- 100 tiles means a full field costs essentially nothing.

Flow fields also solve freeform movement cleanly: units get a smooth direction vector at any continuous position rather than a chain of waypoints to snap between.

Cliffs are impassable edges. Ramps are the only edges between tiers. Player-built structures are impassable in the primary route and ignored only by the terrain-only fallback (see section 6).

Units climbing a ramp move at **40% of their normal speed**. Their vertical position follows the stair flight continuously from the lower tile to the upper landing; never sample a rounded tile height and ease after the boundary, which makes units sink into the steps and then pop upward.

The king follows the same continuous stair surface but climbs at **75% of his normal speed**, preserving his mobility advantage while still giving the ascent visible weight.

**Diagonal crossings.** Two diagonally touching tiles at the same height may connect unless both of the other side tiles in that 2x2 corner are higher than the endpoints. One higher side is allowed; the other side leaves enough room for the crossing. Price this edge at `sqrt(2)` versus `1` for an orthogonal step. Mismatched endpoint elevations have no diagonal edge. Keep a narrow constant-height corridor along rounded-corner crossings so units and the king never change height while traversing them.

### Knockback
Spear Bunker hits push enemies back roughly 0.5 tiles.

**Cliff edge rule, must be decided.** When knockback pushes a unit toward a cliff edge, either clamp at the edge or let it fall and take damage. Falling is more fun and fits the hero's jump-down mobility, but it needs a fall-damage code path. Defaulting to clamp for the prototype.

---

## 9. Combat

### Elevation and range
Height advantage matters symmetrically:

- Shooter on higher ground gets **+range** against lower targets
- Shooter on lower ground gets **-range** against higher targets

A tower on tier 3 outranges an enemy archer on tier 1 twice over: it reaches further and the archer reaches less far. Enemy archers must physically close in to threaten elevated towers, which is the pressure that makes high ground worth the walk from the ramp.

Suggested: +/- 0.75 tiles per tier of difference, capped at 1.5.

### Two projectile trajectories

**Arcing** (archer, fortified, catapult, castle, hero, enemy archers). Parabolic. Clears terrain between shooter and target.

**Near-flat** (ballista). Nearly straight line. Blocked by terrain an arc would clear.

These need **two separate LOS code paths**. Decide this at implementation time rather than bolting the flat check on later.

```js
function hasArcLOS(from, to, terrain) {
  const apex = Math.max(from.y, to.y) + ARC_APEX_OFFSET;
  for (let i = 1; i < ARC_SAMPLES; i++) {
    const t = i / ARC_SAMPLES;
    const x = lerp(from.x, to.x, t);
    const z = lerp(from.z, to.z, t);
    const y = parabolaY(from.y, apex, to.y, t);
    if (y < terrain.heightAt(x, z) + LOS_EPSILON) return false;
  }
  return true;
}

function hasFlatLOS(from, to, terrain) {
  for (let i = 1; i < FLAT_SAMPLES; i++) {
    const t = i / FLAT_SAMPLES;
    const x = lerp(from.x, to.x, t);
    const z = lerp(from.z, to.z, t);
    const y = lerp(from.y, to.y, t) + FLAT_ARC_LIFT * Math.sin(Math.PI * t);
    if (y < terrain.heightAt(x, z) + LOS_EPSILON) return false;
  }
  return true;
}
```

`FLAT_ARC_LIFT` is small, just enough that the bolt reads as a projectile rather than a laser.

**Caching.** Do not run LOS per frame per shooter per target. Cache per (shooter, target) pair, invalidate when the target crosses a tile boundary.

**Targeting consequence.** Shooters acquire the nearest target **with valid LOS and outside minimum range**, not simply the nearest. If a current target moves behind a cliff or inside the dead zone, drop it and re-acquire.

**Arrow impact presentation.** Arrows are simple short white lines without decorative heads or fletching. A hit continues a short distance through the target before remaining embedded for five seconds and following that target's movement. If another attack kills the target first, the arrow becomes a physical miss and continues under gravity: it plants in land for five seconds, or preserves its impact velocity through water for 0.2 seconds while creating two expanding circular ripples. Catapult splash projectiles still resolve and disappear at their impact point rather than embedding.

### Minimum range
Archer 0.5, Ballista 1.5, Catapult 2.0. Minimum ranges do **not** scale with board size -- a dead zone is a fixed physical property of the weapon, not a fraction of the map. A target inside the minimum is not a valid acquisition. The Fortified Tower's burning rocks are a separate attack that specifically covers its own dead zone, fired simultaneously with the arrow volley.

---

## 10. Enemies

Cap: **40 concurrent enemies.** Design waves against this ceiling.

| | Grunt | Archer | Brute |
|---|---|---|---|
| HP | 40 | 25 | 200 |
| Speed | 1.0 | 1.0 | 0.6 |
| Attack | Melee | Ranged, 4.5 tiles, arcing | Melee, heavy |
| Threat | Volume | Outranging bunkers | Breaking a chokepoint |

### Targeting behavior
- **Castle first.** On landing, every enemy's primary objective is the castle. It follows the two-pass castle routing in section 8: first respect terrain, ramps, and player-built obstacles; if that has no viable path, retain terrain and ramps but ignore player-built obstacle occupancy for navigation.
- **Priority 1: retaliation aggro.** When a building or the king damages an enemy and is within `aggroRange`, the enemy immediately targets that attacker, overriding castle routing and proximity aggro. This target is locked: it does not switch or give up while the attacker lives and remains within `attentionRange`.
- **Retaliation pursuit.** If the retaliation target is outside attack range, the enemy attempts to path into attack range. If no valid path exists for any reason, even while the target remains in aggro or attention range, clear the retaliation target and resume castle-first routing.
- **Priority 2: proximity aggro.** Only when there is no valid retaliation target, a building entering `aggroRange` becomes the target. The enemy moves into attack range if necessary. This applies to towers, barricades, bulwarks, houses, and the castle.
- **Target validity.** A retaliation target is released only when it dies, leaves `attentionRange`, or is unreachable. A proximity target is released when it dies, leaves `aggroRange`, or is unreachable. In either case, the enemy resumes castle-first routing and may then acquire a new building by proximity aggro.

`aggroRange` is a per-unit stat, always slightly greater than `attackRange`. `attentionRange` is slightly greater than `aggroRange` and exists only to keep a retaliation target stable at the aggro boundary. Put both small buffers in the central config. They let a unit notice and react to nearby defenses without making buildings or the king pull the whole wave across the island.

### Attack state
- Changing targets never resets or refills an enemy's attack cooldown.
- Attacks with a windup are interrupted by knockback, stun, target death, target loss, or any other event that invalidates the attack. An interrupted windup deals no damage and does not consume a cooldown.

Enemy archers stop at range and fire. They outrange a spear bunker and grind an elevated tower down from outside its reach if allowed to settle. Someone must deal with them. That someone is you.

---

## 11. Boats and wave spawning

### Spawn and approach
1. Wave begins. Boats spawn on open water beyond the island.
2. **Every boat steers toward the exact center of the map.**
3. Approach lasts roughly 10 seconds.
4. Boat reaches shore and unloads onto its landing point.

### Landing resolution
Because heading is fixed toward center, the landing point is where that ray meets the island. Validate at spawn time:

```
For a candidate spawn angle:
  1. Cast a ray from the spawn point toward map center.
  2. Find the first island tile it intersects.
  3. Reject if that tile is a cliff face the boat cannot unload onto.
  4. Reject if the landing point is within MIN_LANDING_SEPARATION
     of an already-claimed landing point this wave.
  5. Reject if the spawn angle is within MIN_SPAWN_ARC of another
     boat's spawn angle this wave.
  6. Otherwise accept, claim the landing point, claim the angle.
```

Retry on rejection with a bounded attempt count and a fallback to a hand-authored landing tile, so a wave can never fail to spawn.

**Same tile, different point.** Two boats may land on the same tile, since tiles are large. They may not land on the same *point*. `MIN_LANDING_SEPARATION` is in continuous space, not tiles.

**Minimum spawn arc** keeps boats from overlapping visually during approach or converging on the way in.

**The hull is one lofted solid, not an assembly.** The first version was an
eight-vertex shell with a CLOSED TOP, which caused every complaint about it at
once: the floor and benches were drawn inside a sealed lid and never seen, the
gunwales floated above that lid with nothing joining them to it, and the stem
posts reached y=0.4 carrying finials out past the ends of the boat. It read as a
pile of parts because that is what it was.

The second attempt fixed the assembly but capped it with a flat deck, which read
as a slab: a boat is a BOWL and the eye wants to see down into it. Each of the
six cross-sections therefore carries FOUR heights -- keel, sheer, interior floor,
and an inner half-beam offset from the outer by the planking thickness -- and
consecutive pairs are skinned with an outer side, a bottom, a rim band, an inner
side and a floor. The interior pinches shut at the two tips on its own, because
the inner half-beam clamps at zero there.

Everything that sits on it is placed from that same table, so the thwarts span
the beam they actually stand at and the gunwale follows the sheer it belongs to.
Overall height came down about a quarter, the keel now sits below the waterline
amidships, and passengers stand on the interior floor with the rim crossing their
shins rather than perched on a lid.

**Beaching.** A hull grounds SHORT of the water's edge -- the approach march in
landing.js stops at the last water sample, which put the bow practically on the
sand -- and then tilts a few degrees bow-up as it rides the shelf, easing in
rather than snapping. Both are render-and-spawn detail; the simulation still
treats a grounded boat exactly as before, and passengers still disembark onto the
landing TILE rather than onto the hull, so nothing downstream moved.

The tilt uses Euler order YXZ so the pitch happens about the hull's own lateral
axis with the heading applied after it. With the default order the two interact
and the boat yaws as it tilts.

**And it is flattened to a single draw.** Nothing on a boat articulates -- the
oars are scenery -- so the whole vessel is rigid and goes through the same
`flattenGroup` the structures use. Twenty-two meshes per boat become one, which
matters because boats are NOT instanced and a wave lands four of them.

### Shootable approach
Boats cannot be damaged or destroyed. Passengers are individually valid targets for the entire approach, so towers covering water and the hero can thin the landing party before it lands.

This is the most important element in the wave loop. It turns the 10 second telegraph from dead time into an active decision and makes hero positioning a fresh choice every wave instead of park-and-forget.

**Enemy archers shoot back during approach.** They fire at shore-adjacent towers from the boat. Building on the waterline is strong but exposed, which is the tradeoff that makes shore placement interesting rather than automatic.

Passengers have no spawn, landing, or disembark protection window. Damage and death resolve immediately at every point of the approach and landing.

### Wave definition

```js
{
  boats: [
    { delay: 0,   units: ['grunt','grunt','grunt','grunt'] },
    { delay: 2.5, units: ['grunt','archer','archer'] }
  ],
  goldDropChance: 0.35   // secret per-wave economy dial
}
```

**The candidate landings are enumerated once per level, not sampled.** Every
approach angle that ends at a real beach is resolved at load and the spawner
picks from that list, so the rejection loop above is a filter over known-good
options rather than guess-and-retry. Three things follow. A boat can never choose
coastal cliff, because cliff is not in the list. A cliff-heavy coast costs
nothing -- it is exactly the case where guessing degrades worst and enumeration
does not degrade at all. And a wave cannot fail to spawn for want of tries.

The constraints relax in order rather than all at once, because they are not
equally important: the authored sector is given up first, then the spawn arc, and
`MIN_LANDING_SEPARATION` last. Landing on top of another boat is the worst
outcome, so it is the one defended hardest.

A boat may name the shore it comes from -- `from: 'N'`, any of the eight compass
points -- which restricts it to that sector. The sector is a preference, not a
contract: a boat that asks for a shore with no beach on it lands on a real one
somewhere else rather than not landing.

Levels 2 and 3 escalate through simultaneous landings on opposite shores, the
natural difficulty curve for a single-hero game: you cannot be in two places. It
is authored with `from`, because without it "two boats land on opposite shores at
once" is something that happens to a wave rather than something a wave is.

**But measured, the split makes a wave easier, not harder, for a defence that
does not move.** See P5's notes in section 18 before sizing a split wave.

---

## 12. Economy

**Sources**
- **House income**, at start of build phase per surviving house.
- **Kill gold**, a per-wave authored drop chance (`goldDropChance` in
  `config.waves.levels`). Not a global constant. Primary pacing dial, and the one
  that had to be built before P5's economy could be tuned at all -- until then
  every kill paid, and a level-one run banked roughly twice what the level asks
  for. It is per wave rather than per enemy on purpose: retuning enemy gold to
  make wave 5 pay less also changes what a brute is worth relative to a grunt,
  as a side effect of a decision that had nothing to do with either.

**Coins** drop as ground pickups the hero walks over. On a cleared wave, remaining coins fly to him automatically. Manual pickup is a feel-good mechanic and a reason to move during lulls, never a requirement.

**The hero does not drop gold on death.** Dying costs time, not economy.

### Tuning targets
- Start with enough for exactly one archer tower plus one barricade, so wave 1 forces a real choice.
- Level 1 should support 3 to 4 towers by wave 3.
- **Level 1 should allow exactly one T3 tower by the final wave.** With eight endpoints across six waves, most players will only ever reach T3 once or twice per level. That is correct, but it means the gold curve determines whether T3 exists in practice at all.

---

## 13. Hero

### The arrival (level one)

Level one opens on a cutscene: the king sails in from the south-west on his own
boat, the camera locked on him at six times the normal magnification and easing
back to the default framing, and he leaps ashore before control passes.

**It is a LEVEL property, not a game one.** A level with an `intro` block opens
on `PHASE.INTRO`; a level without one opens on castle siting exactly as before.
Only level one has it, because you arrive at the realm once. `restartLevel`
replays it.

Almost none of it is new machinery, and that is the point:

- The boat is an ordinary record pushed into the list `waves.js` fills, so the
  boat view draws it without knowing the cutscene exists.
- The leap is the **cliff jump**, which already had an anticipate / airborne /
  landing animation and a pose to go with it. It takes an optional start height
  so it can begin at the deck instead of at a tier.
- The camera needs no cutscene mode at all, because it already follows the king.
  He rides the boat by having his position written each step rather than by
  being a passenger -- passengers are enemies, drawn from the enemy rigs.

`sim/intro.js` therefore owns only the ORDER of those things and the moment
control passes.

**The pull-back finishes just before the handover** (5.3s against a cutscene of
about 5.6s), so the camera completes its move, holds a beat, and only then gives
the player control. Running past it would leave their first frame of input still
drifting, and freeze the framing a hair off default.

**"From the bottom of the screen" is not a direction you can write down in tile
coordinates without checking.** At the default yaw, tile (+1,+1) projects to
almost exactly screen-down -- 60px across against 205px down -- while (-1,+1),
which reads like "south-west" on paper, projects 357px LEFT and only 34px down.
The first version of this cutscene used the latter and arrived from the side.
Measure the projection; do not reason about the compass.

**FOLLOW_HEIGHT had to become a screen-space quantity.** It lifts the king off
his feet so he sits on the centre line, and as a flat world offset that is 23px
at the default framing but 140px at the cutscene's 6x -- putting him well below
centre in the one shot that is entirely about him. It is now scaled by the
frustum, which leaves normal play identical and the cutscene correctly framed.

### Movement
Tap ground to move. He paths there and stops.

- Tap issues a move order; tapping again mid-move cancels and repaths. No queuing.
- Same passability rules as enemies, plus downward cliff traversal at any edge. He first walks close to the edge, stopping roughly 0.1 tile short of it; only there does he lock into an anticipation pose, hop upward and forward, fall to the lower terrace, then land in a knee-bent recovery pose with a small dust cloud. Movement input cannot cancel or redirect the locked sequence.
- Among equally short flow-field steps, prefer the king's current path heading. Hold each chosen waypoint until he reaches its tile center before selecting another, preventing rounded tile sampling from producing mid-tile zigzags.
- He moves freely during build phase. His position when READY is pressed is where he starts the wave, so pre-positioning is a real decision.
- An active move order marks its exact destination with a bright untone-mapped yellow hollow circle and downward pointer. The circle uses a deliberately heavier stroke than other ground indicators so it remains legible against pale stone.
- His walk animation runs at roughly 1.3x the standard distance-based gait cadence. This is presentation only and does not change movement speed or arrival time.

**A tap he cannot honour snaps to the nearest spot he can.** Tapping inside a
house used to do nothing at all, which reads as a dropped input rather than as a
refusal. It now walks him to the nearest place he can stand, searched in rings
outward from the tile touched.

Candidates are ordered by distance from the POINT touched rather than from the
tile centre, and the destination is the spot inside the chosen tile nearest that
point, held 0.15 clear of the boundary. Tapping the north wall of a house sends
him to its north side and the west wall to its west side; the snap follows the
finger instead of picking an arbitrary neighbour.

**Bounded by `hero.snapRadius`, and the bound is the design.** The original code
refused these taps on the grounds that redirecting one "would look like the input
was misread" -- right about DISTANT snapping and wrong about local. Walking to the
edge of the building you touched is obvious; walking across the island is not.
Past three tiles the tap is still ignored. `snapAttempts` caps the reachability
tests one tap may cost, and reachability itself is unchanged: every candidate
goes through the same commit path the strict version always used, so there is
still exactly one implementation of "can he get there".

Measured at **0.0029 ms per snapped tap** -- about one unit's worth of pathing,
once, on a tap. Tapping all 100 tiles of a level gave 62 direct moves and 38
snaps, worst snap distance 2, and zero destinations that were water, occupied, or
outside their own tile.

Two consequences worth knowing: water within the radius snaps to the shore, which
is useful and was not specifically asked for; and the snap can land him ON an
archer tower or barricade, because tap-to-move has always let the king stand on
those. It inherits that permission rather than inventing a new rule.

### Attack
Fully automatic. Fires at the nearest enemy with valid arc LOS in range, including enemies still on boats. A forceful upper-body draw, release, and recovery animation layers over his locomotion, so he continues moving throughout the shot. The draw is two-stage and exaggerated -- a fast, large raise of the bow arm followed by a long accelerating tension pull -- and the bow itself swings to point at the target while drawn. The release is a fast whip snap back, quicker than the draw. Starting a cliff jump cancels that attack sequence, and he cannot begin or release a shot until the jump and landing recovery are complete. No manual aim, no attack button, no target selection. Tap-to-move is the entire combat input.

**Decided: no hero abilities in the prototype.** The `Island Diorama` mock shows three ability buttons across the bottom (VOLLEY / RALLY / HOLD). Those are superseded and are not to be built. They are mock furniture from an earlier direction, kept only because the mock is frozen as an art reference.

The reason to hold the line: abilities and tap-to-move compete for the same thumb and the same bottom third of a 720x1280 frame, and an ability bar quietly turns the king from a positioning problem into a cooldown rotation. Positioning is the thing being prototyped. If the hero ends up feeling passive once waves are tuned, the first lever is his damage and his range, not a new button.

The bottom third stays reserved for build UI in build phase, and near-empty in combat.

Suggested: range 4.25 tiles, arcing. Damage tuned so grunts die in two shots and brutes are a genuine grind.

### Death and revival
- He has HP and can be killed by any enemy that has him in range.
- On death he leaves play and revives after a delay at a fixed respawn point.
- Delay starts at **6 seconds**, +2 seconds per subsequent death **within the same wave**. Resets each wave.

One death is a setback, repeated deaths spiral, and the per-wave reset stops a bad wave from poisoning the level.

### Lose condition
**The wave is lost the instant the castle falls**, regardless of the hero, tower, or house state. Tower and house destruction alone never loses a wave while the castle survives.

The hero and remaining towers can hold a last stand around the castle, but the king cannot win after it falls. This makes failure immediate rather than a drawn-out solo cleanup.

### Failure recovery
On loss, offer:
- **Restart wave.** Resume from the start of that wave with the layout and gold you had entering it. Default highlighted option.
- **Restart level.** Back to wave 1.

Restart-wave is what makes a prototype finishable.

---

## 14. Camera, input, and rendering

### Target format
**Portrait, 720x1280.** Island occupies the upper two thirds, UI below.

### The camera follows the king

Thronefall keeps the player character at the centre of the frame, and P6b adopts
that: `config.camera.FOLLOW`. The look-at target rides the king rather than
sitting on the island centre, so he holds the middle of the VISIBLE area --
which `VIEW_OFFSET_Y` puts above the HUD rather than at the true centre of the
screen, and following must not undo that.

**Fed the same interpolated position the hero view draws him at.** Reading the
raw simulation position instead would put the camera and the figure on different
sub-frame positions, and they would jitter against each other every frame.

`FOLLOW_LAG` is 0.09s and **0 gives a hard lock**, which the code supports. It is
not zero by default because the camera would then inherit every sudden
correction made to the king -- the separation pass shoving him off a wall, and
above all the cliff jump, which moves him a whole tier in a few frames and would
throw the entire frame with him. Measured: at rest he sits on the exact centre
pixel, walking he trails it by at most 44px, and the worst single-frame camera
step through a cliff jump is 0.29 world units, under a third of a tile.

The base camera position is cached, and the cache now has TWO inputs -- the yaw
and the target. Keying it on the yaw alone is what froze the camera when shake
was added; a moving target would have frozen it again the same way.

### Camera
Fixed isometric-style pitch at fixed distance, orbiting the island.

- **Rotation.** One-finger drag rotates around the island's center axis. Free continuous rotation, no snapping.
- **Zoom.** Buttons in a top corner plus two-finger pinch. Clamped min and max distance. Zoom changes distance only; pitch never changes.
- Pitch around 35 degrees from horizontal. Steeper than this and cliff faces get almost no screen space.
- No free pan. The island is always centered.

### Gesture disambiguation
Drag-to-rotate and tap-to-move share the same finger. Highest-risk input design in the project.

```
touchstart        -> record position and time, state = PENDING
touchmove         -> if distance > DRAG_THRESHOLD (~12px):
                       state = ROTATING, begin camera rotation
touchend
  state PENDING   -> issue move order (regardless of elapsed time)
  state ROTATING  -> no move order
Two touches at any point -> state = PINCHING, cancel any pending tap
```

The threshold is distance-based, not time-based, so a slow deliberate tap still moves the hero. Once a gesture becomes a rotation it can never resolve into a tap. A second finger cancels a pending tap outright.

Test on real hardware early. This either feels invisible or feels broken, with little in between.

### Pause
Combat can be paused. While paused the camera still rotates and zooms so the player can survey and plan. No orders issued, no build UI. Mobile players get interrupted, so pause is not optional.

---

## 15. Art direction

Low-poly island diorama, bright and saturated, sitting in open water.

### The hue separation rule
This is a saturated scene, so brightness alone cannot signal what matters. Separation is by **hue**.

**Environment owns cool and green:** cyan water, yellow-green grass, near-white rock.

**Gameplay owns warm and dark:** near-black enemies, maroon boats, crimson damage, gold and red for the king.

Nothing in the environment is permitted into red, orange, gold, or deep maroon. Any warm color on screen is therefore immediately understood as gameplay-critical.

### Palette

```
Water deep:    #4ec3d9
Water shallow: #7ad4e4   band hugging the island ~0.6 tiles
Foam rim:      #ffffff   thick, soft outer edge
Grass lit:     #a8cc5c
Grass shade:   #7fa843
Bushes:        #5f8f3a
Trees:         #3d6b2e   far darker than grass
Rock lit:      #faf8f4
Rock side:     #e4e0d8
Rock shaded:   #ccc6ba
Shore sand:    #efe9d5
House wall:    #f4f1e6
House roof:    #c8b89a

Enemy unit:    #2a2a30
Enemy boat:    #6b3a4a
Blood decals:  #a8324a
King crown:    #f2c14e
King cape:     #c2352f
King body:     #3a3a42
```

Push **value** separation between adjacent materials, not just saturation. Tree canopy must sit far darker than grass. Without a wide value gap, a saturated palette collapses into candy-colored mush. Test in greyscale.

### Softness, programmatically

Three things produce the reference look, and none of them are cast shadows:

**Beveled edges.** Every rock block, house, tower, and boat gets a small chamfer, roughly 2 to 3 percent of a tile. The bevel catches light as a thin soft highlight along each edge. Highest-impact single change. Forms stay chunky and faceted, they just stop having razor corners.

**Ambient-dominant lighting.** Directional intensity ~0.35, hemisphere ~0.85. The directional light exists only to separate cliff faces from tops by value. All softness comes from the hemisphere fill, sky tinted cyan, ground tinted warm neutral.

**No cast shadows at all.** Turn shadow mapping off. Replace with:
- **Blob shadows.** Circular mesh on the ground beneath every object with a radial alpha gradient, darkest at center, ~20% opacity, transparent at the rim. Never aliases, reads softer than any shadow map at this scale.
- **Vertex-baked AO.** Computed once when the terrain mesh is built, multiplied against material color. Darkens where cliff faces meet grass, in inside corners, beneath overhangs. This does the work cast shadows were doing, but softly.

Terrain is static per level, so AO baking is a load-time cost you pay once. Sixteen rays per vertex is plenty at this scale.

### Geometry rules
- **Merge coplanar tiles.** Tiles extruded individually produce vertical seams in the middle of flat ground and make the island read as a mosaic of plates. A tier should be one continuous shelf with side faces only at its actual perimeter.
- **Solid island mass.** The island is one solid rock body with tiers cut into it. No tier cantilevers over open air. Every elevated shelf sits on rock continuing to water level.
- **Ground contact.** Sink every structure ~0.02 tiles into the surface. Nothing hovers. Boats intersect the water plane with a small foam ring at the waterline.

### Scale, in tile units

```
Elevation tier height:  0.6
Soldier height:         0.5
Soldier width:          0.18
King height:            0.7
Tree height:            0.6 to 0.9, varied
Bush height:            0.15
House:                  1 tile footprint, 0.8 tall
Tower:                  1 tile footprint, 1.0 tall (T1)
Boat length:            1.2
```

A soldier is roughly one third the height of an elevation tier. If a soldier looks comparable in height to a cliff face, scale is wrong.

Cluster trees into groves with open ground between, varying height and sphere count. Evenly scattered uniform trees look procedural.

### Unit animation

**All animation is procedural. No skeletons, no keyframes, no imported clips.** Every figure in the game is a stack of boxes a few centimetres across on screen; a skinned pipeline would cost more than the fidelity it buys, and at 40 units it would cost frame time too.

Instead, each rig keeps named references to its parts and is driven from a small set of scalars.

**Rig requirement.** Limbs need a pivot at the joint, not at the mesh centre. `bevelBox` builds from its base upward, so each arm and leg goes inside a pivot `Group` positioned at the shoulder or hip, with the mesh hanging below it. Get this wrong and limbs rotate about their middles and the figure reads as a broken puppet. This is the one structural change the existing diorama rigs need.

**Walking**, driven by one `gaitPhase` that advances with distance travelled, not with wall-clock time. Advancing on distance is what keeps a slowed brute from moon-walking and a knocked-back unit from paddling in place.

- **Legs swing** in opposition about the hip, roughly +/-0.5 rad.
- **Arms counter-swing** about the shoulder at about 60% of the leg amplitude, opposite phase to the leg on the same side. A held spear damps its arm further so the weapon does not windmill.
- **Body bounces** vertically at **twice** the stride frequency -- one rise per footfall, not per stride. Small: about 3% of unit height. This single term does most of the work of making a box stack look alive.
- **Body sways** side to side, rolling into the planted leg, about +/-0.06 rad at stride frequency.
- **Body yaws** slightly against the arm swing, about +/-0.04 rad, so the torso counter-rotates rather than travelling rigid.

**Idle** is the same rig with the legs locked and everything else scaled to roughly 15%, run on a slow independent clock so a crowd standing still does not breathe in unison.

**Turning** is a damped approach of facing toward the movement direction rather than a snap, so a unit rounding a barricade banks into the turn.

**Phase decorrelation is mandatory.** Seed each unit's `gaitPhase` from its id. Forty units marching in perfect lockstep is the single most artificial-looking failure mode available here, and it is free to avoid.

**Amplitude scales with speed** so a brute at 0.6 speed reads as heavy rather than as a grunt in slow motion: longer stride, deeper bounce, slower cadence.

Attack, damage and death are the same idea and belong on the same driver: a lunge is a forward pitch of the torso plus a shoulder rotation over ~0.2s, and a hit is a brief scale-and-tint pulse. On death, an enemy quickly topples backward about its feet with both arms spread, remains lying where it fell until two seconds after death, then sinks fully below the surface over the following two seconds. The corpse is non-targetable and non-colliding immediately, does not consume the living-enemy cap, and is removed after the sink completes.

### The king
Dark neutral body with actual torso and legs. Faceted golden crown, 3 or 4 blunt points, on a brighter material so it catches light in shadow. Red cape as a flat angular sheet from the shoulders, wider than his body, trailing behind.

**The cape is the primary read.** It should be the largest patch of pure red on screen. At maximum zoom-out the player should locate the king in under a second by scanning for red against yellow-green. Add a soft warm ground ring beneath him so he stays findable in a crowd.

Build and test the king first, alone, at maximum zoom-out distance. If you cannot spot him among thirty enemies at that distance, the cape needs to be bigger or the crown brighter before anything else gets built.

### Three.js setup
- Orthographic camera, fixed pitch, rotatable yaw, variable zoom. Orthographic keeps elevation tiers reading cleanly.
- `MeshLambertMaterial` everywhere. No textures anywhere.
- **Do not pass `flatShading: true` to it.** Lambert shades per-vertex and ignores the flag, warning once per material. The faceting comes from the geometry instead: terrain is emitted as non-indexed triangles, and box/extrude geometries carry hard per-face normals, so every facet shades flat on its own. Reach for `MeshStandardMaterial` only if a material genuinely needs `flatShading` honoured, and pay the cost knowingly.
- Background is a flat gradient in the water tone. No horizon, no sky, no distant terrain.
- Single global saturation and contrast pass at the end, exposed as one adjustable uniform. Author materials at the values above and push the final look with the slider rather than re-tuning individual colors.
- No bloom, no heavy depth of field.

### Readability under rotation
Rotation introduces occlusion a fixed camera would not:
- Fade or x-ray structures occluding units behind them. **Built in P6**, in view
  space rather than by raycast -- see section 18. Scenery counts: the keep was
  moved out of the static batch so the rule could reach it, because it is the
  tallest thing on most islands and "no exceptions" means no exceptions.
- Ground marker under every unit so position is unambiguous across elevations.
- If a unit can be attacked, it must be visible. No exceptions.
- The directional light stays fixed in world space while the camera orbits. Verify all four yaw quadrants. There will be one angle where cliff faces go flat. Either raise ambient fill until it stops or rotate the light with the camera at a fraction of the yaw.

### Performance
At 40 enemies on a 10x10 grid with flow-field pathing, this is not demanding. Do the easy wins and stop:
- Merge static terrain into one geometry at load.
- Instance repeated meshes: enemies per type, projectiles, coins, towers.
- Pool anything with a lifecycle. Never allocate in the frame loop.
- Fixed timestep simulation, interpolated rendering.

Do not build for 1000 units. The design caps at 40.

### Measured in P0: the rig is the draw-call budget

With 15 walkers on screen the scene costs **170 draw calls, ~150 of which are the
units**. The static island is already collapsed to a handful; almost the entire
budget is the dynamic root.

The arithmetic is simply parts times units. An animated soldier is nine meshes
plus a blob shadow, so the cap of 40 enemies lands around 400 draw calls before a
single tower, projectile or coin exists. That is too many for the weak-GPU tier.

**The fix is one InstancedMesh per body part, not fewer body parts.** All forty
left legs are one instanced draw, all forty helmets another, and so on -- ten
draws total regardless of unit count. This composes perfectly with the procedural
rig of section 15, because the animator is already computing a per-unit transform
for every joint; instancing only changes where that transform is written.

Not worth doing while unit counts are small and the rig is still changing shape.
Worth doing before P3 puts forty units on screen, and worth *not* forgetting,
because it stops being a small change once towers and projectiles are also
allocating draws.

---

## 16. UI

Bottom-anchored, thumb-reachable, sized for 720x1280.

### Pick, place, confirm

Building takes three presses, and each one answers exactly one question:

| step | question | state |
|---|---|---|
| press a bar button | **what** am I building | arms a type |
| tap the ground | **where** does it go | proposes a spot |
| press the checkmark | am I **sure** | spends the gold |

**Nothing is ever armed by default.** Not at the start of the build phase, and not on arrival at the castle phase either. Until a button is pressed, a tap means what it means everywhere else in the game: move the king. This matters most at the very beginning -- the opening beat of a level is walking the island and reading it, which is the decision the castle siting is *about*, and a placement UI switched on over the top of that gets in the way of it.

Pressing the armed button again disarms and puts the map back down. Nothing has been bought at that point, so there is nothing to undo -- only a proposal to forget.

The confirm step is the one that earns its keep. The tap that picks a tile is the tap most likely to be wrong: on a phone there is no hover to check a spot with first, the finger covers the tile it is landing on, and the camera is at an angle. So the tap only *proposes*. A ghost footprint appears on the ground with the true coverage overlay, and a circular checkmark button pops in above it. Nothing is bought until that second, deliberate press on a target already visible on screen. Re-tapping moves the proposal, so a misjudged spot costs a tap rather than a tower.

The checkmark is anchored to the **tile**, not to the bottom bar, and is re-projected every frame -- the camera follows the king and can be rotated and zoomed with a placement still pending. It is clamped inside the stage, because a confirm button that has drifted off the edge is an unfinishable purchase.

**On desktop the footprint also follows the cursor**, before any tap, so a spot can be shopped around without committing to one. It stops following the moment a placement is pending: otherwise reaching for the confirm button would drag the very footprint it is attached to out from under it. Touch has no hover at all, which is why tap-then-confirm is the real mechanism and this is only a convenience laid on top of it. The coverage mesh probes every land tile, so it is rebuilt only when the footprint changes square, not on every mouse move.

**An overlay is only allowed on screen while a decision is live.** An earlier revision made the king himself the cursor -- placement was wherever he stood, so the footprint marker and coverage ring were on for the entire build phase. That failed for a reason worth writing down: *a permanent slab of UI parked on the character you are trying to look at is worse than no preview at all.* Coverage is wanted at the moment of decision, not continuously. Hence: no ghost until a tap proposes one, and none again the moment it is confirmed or abandoned.

**Everything is dismissible without a mode to escape.** Pressing the armed bar button again disarms and drops the proposal; arming a different tower does the same, because a spot chosen for a barricade is rarely the spot for a ballista. Confirming keeps the type armed so a run of towers is press, tap-confirm, tap-confirm -- but drops it once the purse cannot cover another, so the bar never advertises something that can only be refused.

An illegal tile still gets a ghost, in red, and simply has no confirm button. "You cannot put it there" is information the player asked for by tapping.

**Castle siting uses the identical flow**, which is the point: it is the first placement a player ever makes, so it is what teaches the model. Its "what" button is a single large round one carrying the keep glyph, because there is only ever one thing to place -- but it arms, disarms and confirms exactly like the tower bar does.

**Build phase**
- The bottom UI contains only tower buttons with costs and the READY button.
- Gold counter, wave indicator (`Wave 3 / 6`).
- Large READY button, bottom right.
- Range overlay on the ground **under the pending placement only**, showing **both** the maximum range and the minimum-range dead zone. It must account for real terrain LOS, and for ballista it must reflect flat-trajectory blocking. A range circle that lies about cliffs teaches the wrong model of the game.
- The footprint marker is gold fill over a dark outline, red when the tile cannot take it. It was allowed to be a 34%-white wash back when it only flickered up under a cursor; as the thing a purchase is confirmed against, it has to read at a glance over grass, stone and sand alike.
- Tile boundary lines visible exactly while a placement is armed, for towers and the castle alike. They answer "which square am I aiming at", so they belong to placement mode rather than to the whole phase -- and taking them away again is part of what makes disarming feel like putting the map back down.

**Combat phase**
- Gold and wave progress remain in the top HUD.
- Pause button, zoom buttons.
- No bottom UI. One interaction: tap to move.
- Off-screen boat indicators at the screen edge, which matter more given the rotating camera.

---

## 17. Architecture

**ES modules served over HTTP, not a single evaluated file.** The diorama lives inside a design-canvas host that fetches one file, evaluates it with `new Function`, stubs `require`, and injects the other scripts asynchronously -- which is why it has a `PARTS` polling loop and why no part may reference another at load time. That is a design-tool harness. A game needs real imports, a fixed timestep, and dev overlays, so the game does not live there.

Systems communicate through a central state object rather than direct references.

```
Game
|- TerrainSystem      grid, heights, ramps, passability, flow fields, LOS
|- BuildSystem        placement validity, upgrade trees, costs, refunds
|- WaveSystem         wave defs, boat spawn angles, landing resolution
|- CombatSystem       targeting, min range, commitment, projectiles, damage
|- UnitSystem         freeform movement, separation, knockback, radii
|- HeroController     tap-to-move, auto-attack, death and revive
|- EconomySystem      house income, coin drops, auto-collect
|- InputSystem        gesture disambiguation, camera orbit and zoom
|- RenderSystem       Three.js scene, instancing, blob shadows, occlusion
|- AudioSystem        synthesized SFX bus (section 19)
+- UISystem           DOM overlay, phase-dependent controls, pause
```

Simulation stays fully separate from rendering. `RenderSystem` reads state and never mutates it. This makes fixed timestep and interpolation work, and lets you debug combat with rendering stubbed out.

### The static/dynamic render split

**This is the highest-risk piece of architecture in the project and it is not obvious from the diorama.**

The diorama's batcher is destructive on purpose -- its own header says nothing may hold a reference to an individual prop after it runs. It flattens hundreds of meshes into one buffer, which is exactly right for terrain, water, trees and houses, and exactly wrong for anything that moves, upgrades or dies.

So the scene carries two roots:

```
scene
|- staticRoot    terrain, water, nature, decoration   -- batched once at load, never touched again
+- dynamicRoot   units, hero, castle, towers, boats, projectiles, coins  -- live objects, never batched
```

A tower is dynamic even though it stands still, because it upgrades and it dies. Trees are static. The test is whether anything can ever change it, not whether it moves.

Everything in `dynamicRoot` is pooled and instanced by type, and nothing in it is allocated during the frame loop.

### Picking cannot raycast the terrain

After batching, the ground is one non-indexed buffer with no per-tile identity -- a raycast hit tells you nothing about which tile was hit. Tap-to-move and tower placement therefore resolve the tile **analytically**, marching the camera ray against the integer height grid via the board's `at()` and `topY()` helpers. This is cheaper than a raycast anyway. It only needs to be designed in rather than discovered.

### Fixed timestep

Simulation steps at a fixed rate with an accumulator; rendering interpolates between the previous and current step by the leftover alpha. Every rendered entity therefore stores its previous transform as well as its current one. Interpolate angles by shortest arc, and interpolate `gaitPhase` (section 15) the same way, since it wraps.

Put every tunable in one config object at the top: castle stats, tower stats per tier, upgrade costs, enemy stats, hero stats, radii, elevation modifiers, minimum ranges, wave definitions, drop rates, revive timings, gesture thresholds. You will change these constantly.

---

## 18. Build order

**The art pass is already done.** Bevels, vertex AO, merged coplanar tiles, blob shadows, ambient-dominant lighting, the grade pass, and the build-phase grid overlay all exist and are tuned in the diorama. That is the step most prototypes never reach, and it is the step this project started with. Treat the diorama as a visual target to preserve, not as work still ahead.

Everything else does not exist. An earlier draft of this section listed fifteen steps with the art pass last; that ordering is inverted for this project, and it also deferred the riskiest architecture to the point where everything already depended on it. Phases instead:

**P0 -- Rehouse. DONE.** Move out of the design-canvas shell into ES modules over HTTP. Establish the sim/render split, the single config object, the fixed-timestep loop with interpolated rendering, and the static/dynamic scene roots. The diorama must render identically through the new shell. No gameplay.

**P1 -- Vertical slice. DONE.** One level, one tower type, one enemy type, boats, the hero, and a working build -> wave -> build cycle. Every system at 10% depth, real loop. The point is to exercise every boundary once before any of them is load-bearing.

The slice plays: six waves, tower placement with gold, boats that are shootable on the approach, enemies that path around cliffs and commit to a target, free repair between waves, hero death and revive, the lose condition, and restart-wave. What P1 deliberately does *not* have is listed in P2 and P3 below -- above all line of sight, which is why the range overlay currently tells the truth about distance and says nothing about cliffs.

**P2 -- Retire the known risks. LOS DONE; GESTURES NOT YET VALIDATED ON HARDWARE.**

Arc and flat line of sight, minimum ranges and elevation modifiers are built and
tested (`sim/los.js`), and the build overlay now asks the same predicate the
towers do. The gesture state machine is implemented and its pinch bug is fixed,
but the half of this phase that matters most -- *putting it on a phone* -- has
not happened and cannot be done from a desktop. **P2 is not closeable until
someone drags a finger across real glass.** Everything else in it is finished.

**P3 -- Combat depth. DONE.** Separation, push vs hit radii, knockback, castle-first routing, proximity and retaliation aggro, enemy archers and brutes.

**P4 -- Content. DONE.** Full tower tree, upgrade UI, economy, coins, house income, death, revive, lose condition, restart wave and restart level, pause.

Both lines are in with all eight end states, reachable through a tap-a-tower
upgrade panel that shows costs and the takedown refund. Coins drop where a unit
dies and the king picks them up. House income, death and revive, the lose
condition, both restarts and pause were already delivered in P1.

**P5 -- Levels 2 and 3, and tuning. LEVELS DONE; THE TOWER TREE'S ECONOMICS ARE AN OPEN DECISION.**

Twin Capes and The Crown are authored, validated and playable, reached through a
NEXT ISLAND button on the win screen, and the wave tables are now per level so
each escalates against its own terrain -- including authored simultaneous
landings on opposite shores, which is a property of where a level's shores are
and not something to leave to Math.random.

The economy is retuned: a level-one run banked about 700 gold and afforded
thirteen towers where three win it, which made everything P4 built optional. The
per-wave `goldDropChance` of section 12 -- specified since the first draft and
never implemented -- is now the dial that fixes it, and a run banks 360 to 440.

What P5 could NOT settle is whether upgrading is ever worth the gold. It is
measured below and it is a design decision, not a number.

**P6 -- Feel. DONE.**

The event stream has a consumer. Section 19's audio is built -- four synthesis
primitives, twenty-nine sounds, one master gain and three buses, voice caps that
drop rather than queue, and a context that stays suspended until the first tap
and is optional forever after. Camera shake is driven from the same events.
Section 15's occlusion rule is implemented: structures and scenery standing
between the camera and anybody who can be attacked fade to 22%.

Everything here hangs off one seam, which is why it is one phase rather than
three.

**P6b -- The Thronefall pass. DONE.**

Three borrowings, chosen because each was cheap given what already existed:

*Evening light on the wave phase.* Thronefall carries its whole day/night
rhythm in the light, and pressing READY here changed a badge and nothing else.
The scene now tints toward evening while a wave is on the island and eases back
when it clears. **Deliberately not night**: enemy silhouettes are near-black by
section 15's hue rule, and dropping the ambient far enough to read as darkness
would lose them against the ground.

**HUE ONLY, and that is the whole lesson.** The first attempt also dimmed the
key light, lifted the vignette from 0.46 to 0.60 and pulled saturation to 0.94 --
and it read as haze, not as evening. Contrast is the ratio between the lit and
unlit faces of a cliff, so moving the key and the fill apart, or desaturating on
top, is precisely how a scene goes soft. The shipped version holds every
intensity at its daylight value, does not touch the grade pass at all, and
pushes the fog FURTHER out (62-150, from 44-118) rather than pulling it in.
Measured over the island: contrast within 6.4% of daylight, saturation up 41%,
brightness 0.87x.

Leaving the grade alone fixed a second thing by accident -- the old code
overwrote the dev overlay's saturation and vignette sliders every frame.

**The sky is not `scene.background`.** It is a screen-vertical gradient shader on
a 320-unit water plane (`water.js`), which covers the entire frame, so the
renderer's clear colour is never visible. Tinting the background alone changed
nothing and looked exactly like a working feature until the screenshot. The warm
band sits low in the frame and stays desaturated -- 0.38 against the king's 0.76
-- so his cape is still the most saturated thing on screen, which is what section
15's hue rule is actually protecting.

*The wave is telegraphed.* Landings are now resolved when the BUILD phase
begins rather than at spawn, and the wave uses exactly that roll -- so the
build-phase indicators are a promise, not an estimate. If they re-rolled at
spawn the preview would be a lie, which is why `waves.start` consumes
`waves.preview` instead of picking again. Verified across nine waves on three
levels: every boat landed on the tile its badge named.

*Round indicators, one per enemy type per landing.* A count, a shape-coded
glyph, and a triangle on the rim pointing at the shore that boat comes from --
**re-aimed every frame against the live camera yaw**, because a compass that
does not turn with an orbiting view is worse than no compass. Measured against
the boats' true on-screen bearing at four camera angles: aligned to within
0.04 degrees.

*Hit reactions.* A unit that takes damage swells and is shoved back along the
line of the blow. This needed a new `unitHit` event: structures had
`structureHit` from P1 and units had nothing between full health and death, so
an enemy soaking four arrows looked identical to one standing still.

**P7 -- The shell.** Title, level select, and persistence. Three levels and a
NEXT ISLAND flow currently forget everything when the tab closes, which became a
real gap the moment progression landed. Settings, which audio now needs a home
for beyond the mute button.

**P8 -- Playtest and balance.** With a human, on hardware, resolving the open
items. Every balance number in this document came from a harness where the king
never moves; they are floors.

**Still blocking, and older than any of these: P2's phone test.** Tap-to-move and
drag-to-rotate share one finger. If that feels wrong the control scheme changes
and it invalidates everything built after it, not before. It is also the only
way to measure real-device performance -- every millisecond quoted here is a
desktop number.

### The three risky pieces

Two were flagged in earlier drafts and one was missed:

1. **Gesture disambiguation.** Tap-to-move and drag-to-rotate share one finger. If it feels bad the control scheme changes, so learn it early and learn it on a phone.
2. **Arc vs flat LOS.** If flat-trajectory blocking is fiddly to get right, the ballista changes.
3. **The static/dynamic render split** (section 17). This is the one that was missed, and it is the worst of the three, because the diorama's batcher actively destroys the object references a game needs. You find out whether the boundary is clean only by running a whole loop through it once -- which is precisely what P1 is for.

### What P3 actually taught us

**Two systems landing in the same phase found each other the hard way.** Hard
collision holds a unit at `0.5 + pushRadius + STRUCTURE_CLEARANCE` from a
building. Melee reach was authored independently, at 0.65 for a grunt and 0.75
for a brute. The standoff is 0.72 and 0.80. Every melee attacker was therefore
held *further out than its own arm* -- it walked up to a wall and stood there
forever, aggroed, hitting nothing. It looks exactly like a pathing bug and it is
arithmetic. **Any melee `attackRange` must exceed that unit's collision
standoff**, and the config now says so beside both numbers.

**The behaviour chain works, and it is legible in one trace:**

```
0s   castle (route) walking          castle-first
0s   house@3,8 (proximity) walking   a building in the way is noticed
1s   house@3,8 (proximity) attacking
9s   DESTROYED house@3,8
9s   castle (route) walking          objective resumed
17s  castle (proximity) walking
51s  *** CASTLE FELL ***
```

Retaliation holds its lock against a competing proximity target, and a hit from
outside `aggroRange` provokes nothing -- verified at 0.89 (provoked) and 4.48
(ignored). Walling the castle in with eight towers makes the primary field
unreachable and the terrain-only fallback take over, exactly as section 8 says.
The castle falling ends the wave with all four houses still standing.

**The island supports the 2x2 castle better than first measured.** On a clean
board there are **11 legal sites** -- eight across the tier-2 shelf and three on
the tier-1 shore. An earlier count of four was taken on a board that still held
the previous test's towers, so occupancy was eating sites that are in fact free.
Worth recording as a caution: any measurement of placement legality has to start
from a reset, or it silently measures the last experiment instead of the level.

**A silhouette has about ten pixels to work with.** Measured at maximum zoom-in:
grunt 10.4 screen pixels tall, archer 9.4, brute 15.0. Zoomed out: 5.0, 4.4, 6.9.

> **These numbers are stale and have not been re-measured.** The grunt was
> rebuilt (below), which changed its height, and every enemy was subsequently
> scaled up 10% via `UNIT_SIZE_MULTIPLIER`. The scaling is uniform, so the
> figures above are all a flat 1.10x low; the grunt's was already wrong before
> that. Re-measure before quoting any of them again.
The brute reads instantly at over twice the archer's width. The archer and the
grunt were, to the eye, the same figure -- an upright bow helps the shape and
cannot fix the size, and section 15 has already spent the colour budget by
reserving warm hues for gameplay.

**The grunt was rebuilt to fix that, and the fix was not height.** Making it
bigger would have walked it into the brute, whose whole read is being the big
one. It got *stocky* instead: wider and deeper torso, thicker legs set further
apart, a slight forward stoop, and slightly LESS height than before. Size order
intact, aspect ratio inverted.

Four changes, in descending order of how far away they still work:

1. **A round shield with a bright iron boss.** Enemies are near-black, so an
   unbroken dark blob is the default failure. At twenty pixels the boss is the
   only one of these four that is still doing work -- and a shield is the melee
   read, against the archer's bow. This does not break the hue rule: weapons
   already carry bright metal, and the brute's club head is the same trick.
2. **Wide shoulders.** Pauldrons on the torso, not on the arm pivots, so they are
   armour rather than something that windmills when it walks. The game is watched
   from a high angle, where shoulder span is most of a silhouette.
3. **A slight stoop** -- 3.4 degrees, enough to lean into the walk. It was
   first built at 17, which read as a crouching animal rather than a posture;
   the width and the sunk head, not the pitch, are what make a wide body read as
   a heavy man.
4. **No neck** -- a small head sunk under an overhanging helmet. The head box is
   untextured skin tone on every face, so left large it becomes the brightest
   thing on a figure that is meant to be dark.

**The shield is tilted toward the sky, not just outward, and that is the part
that matters.** The camera watches from about forty degrees up and yaws freely, so
a shield carried vertically is a disc only when its owner happens to be side-on,
and a plank across the chest the rest of the time. Pitching the face up means the
disc is what the camera sees at *every* yaw. Any flat detail added to a unit from
here on has the same constraint.

**The sword is counter-rotated against the stoop**, found by looking rather than
by reasoning: without it the blade lies over and throws away the bright vertical
stroke that was the old figure's only distance read. It is counter-rotated by
*whatever the stoop is*, not by a copied constant, which is why dialling the
pitch from 17 degrees to 3.4 needed no second edit.

The pitch lives in its own group between `bob` and `torso`, because `applyGait`,
`applyDeathPose` and `applyDisembarkPose` all assign `torso.rotation` absolutely
and would silently erase a pitch stored there.

**Separation converged, and knockback clamps.** 99.7% of frames end with no
overlap at all, and none at all among units ashore more than a second; twelve
units piled on one point spread to exactly the required gap inside a 1.96-tile
footprint. A half-tile shove delivers 0.50 on open ground, 0.48 into the sea
(clamped, still ashore), and stops short at a wall.

**One bug produced two unrelated-looking symptoms.** Destroying a structure
retargeted every enemy committed to it -- including passengers still aboard a
boat. That flipped them out of the boat state mid-voyage, whereupon separation
treated them as walkers and stranded them off the edge of the board, where the
position-rescue pinned them. The symptoms were "units sometimes overlap" and
"waves occasionally never end": a physics bug and a wave-logic bug, apparently.
They were one line. Waves that ran 120 to 160 seconds now finish in 14 to 25.

The lesson worth keeping: `retarget` is called from three places and only one had
thought about passengers. Any function that mutates unit state should be explicit
about which states it is allowed to leave.

### What P4 actually taught us

**The visual grammar had to become a parameter, not eight models.** Section 5
promises that wider means more projectiles and taller means more range and HP.
That is only keepable if the shapes are generated from those two axes, so the
archer line is one builder taking `width` and `storeys` and the barricade line is
one builder taking `height` plus a few flags. Twelve tower types, two functions.
The upgrade panel then labels each option WIDE or TALL, so the promise is stated
in the UI and kept by the geometry.

**Two behaviours needed no new code path, which is the point of P2 and P3.** The
ballista is a config entry with `trajectory: 'flat'` -- the LOS work from P2 was
already there and already tested. The spear bunker's knockback is one call into
the separation module written in P3, cliff-clamping included. Building the risky
mechanic before the content that uses it meant the content was a data change.

**Structure instancing had to key on type, not kind.** An upgrade mutates `type`
on a record that is already placed, so a view keyed by `kind` would keep drawing
a garrison as the archer tower it used to be. Keying on type means an upgrade
swaps silhouette for free -- and it is why the tree reads at a glance.

**A latent ordering bug in the aggro code.** `retarget` was clearing `aggro` as
well as setting the objective. Any frame that refreshed the objective therefore
threw away a proximity target acquired moments earlier in the same frame. Only
reachable today when the castle is dead -- which ends the wave -- so it never
surfaced in play, but it would have the moment anything else made `target` go
stale. Objective and interruption are separate concerns and are now resolved
separately.

**Upgrading deliberately does not heal.** HP carries as a fraction across the
swap. Section 7 already bans tower interaction during combat, so this can only
happen between waves where the free repair handles it -- but making the upgrade
itself a heal would have quietly turned it into a repair button the moment that
rule ever loosened.

### What the tuning pass actually taught us

**The economy was decorative.** With the original wave table, level one could be
won with **one tower on the map** and zero damage to anything through five of six
waves. Waves peaked at 13 units against section 10's ceiling of 40, so the king
cleared them single-handed and nothing the player bought mattered. Rescaling the
table toward the ceiling (4, 9, 13, 18, 26, 32) plus the two-shot grunt damage
section 13 always specified (13 -> 20) turned it into a level that can be lost.

**The failure mode is binary, and that is structural.** The castle takes either 0
damage or all 420: nothing reaches it, or a group reaches it and finishes the job
inside one wave. Its own guns are 12 DPS against 420 HP, so it cannot hold anyone
off while help arrives. If waves are meant to *nearly* break through -- and a
difficulty curve needs them to -- the castle needs either more self-defence or
something that throttles a group that has arrived.

**Run-to-run variance is large.** Identical setups differ by whole outcomes,
because boat spawn angles are random and a landing on an undefended shore is a
different game from one that walks into three towers. Eight towers won two runs
of three. Any future balance number needs several runs behind it, not one.

**THE BIG CAVEAT ON EVERY NUMBER ABOVE: the king never moved.** Every one of these
runs is headless, and nothing repositions him -- he stands where he spawned for
the whole level. Section 13 makes his positioning the central decision of the
combat phase, so these figures are a *floor*: what the level does when the player
does nothing. They say the systems now discriminate; they do not say the game is
balanced. That needs a human playing it.

Final convergence also needs P4. Gold currently has exactly one sink, and more T1
towers has already been shown not to help monotonically -- section 12's target of
"exactly one T3 tower by the final wave" cannot even be checked until there is a
T3 to buy.

### What P2 actually taught us

**One predicate, or the overlay lies.** TDD 16 demands a range display that
accounts for terrain, and the only way to guarantee it never drifts from the
truth is to have exactly one implementation of "can this shoot that". The overlay
calls the simulation's own `canHit` per tile and paints the verdict.

The numbers make the case better than the argument does. For an archer on a low
shore tile, **seven tiles that a plain range circle would have promised are out
of reach** -- purely from the elevation modifier, before terrain is considered at
all. Arcs clear cliffs, so an archer is never blinded by them; that is the whole
point of arcing, and it is why its overlay shows no blind tiles.

**The flat trajectory justifies the ballista before the ballista exists.** Running
the P4 ballista spec through the same predicate: from a low shore tile it covers
23 tiles and is *blind on 32 more that sit inside its range*, because the island's
tier-3 core stops a flat bolt dead. Move the same weapon to the summit and it
covers 51. Section 5 claimed the flat trajectory "is its real cost, not flavor"
and that a ballista "wants high ground and open water". That is now a measured
fact rather than a designer's assertion, and it was worth learning before the
tower is built rather than after.

**The curve LOS tests must be the curve the projectile flies.** Both come from
`apexFor`/`arcY`, and neither has its own copy. Verified by sampling every live
projectile every frame across a full wave: **722 projectile-frames, zero below
terrain.** If those two ever fork, arrows clip through cliffs that targeting swore
were clear, and the player stops believing the overlay.

**Caching LOS matters and is trivial.** Terrain is static and a tower never moves,
so the target's tile is the only thing that can change the answer. Measured 93%
cache hit rate in the heaviest wave; live frame rate with 12 towers, 13 units and
three boats stayed at 60.

**Two bugs surfaced only by looking at the screen.** Removed structures left their
meshes behind forever, because the view map hid *destroyed* structures but never
retired *deleted* ones -- invisible to every assertion, obvious in one screenshot.
And restarting a level paid house income for a wave that had never happened,
opening on 100 gold where a fresh level opens on 60. Both had been sitting there
since P1 underneath a green test run. Assertions check what you thought to ask;
screenshots check what you did not.

### What P1 actually taught us

**The static/dynamic split held.** This was the flagged architectural risk and it
cost nothing: two roots, prefab builders shared between them, and the rule that a
thing is dynamic if it can ever *change* rather than if it moves. Towers stand
still and are dynamic. Trees do not move and are static. The keep is scenery, so
its tile is `reserved` in the level data rather than being a structure.

**Flow fields have a direction trap, and ramps hide it.** A field is built by
BFS *outward from the goal*, but a unit travels *inward toward it*, so every edge
must be tested in the direction the unit will really walk -- `canStep(next, here)`,
not `canStep(here, next)`. Every edge in the game is symmetric except one, so the
mistake is invisible until you add the hero's downward-only cliff drop, at which
point it silently disables the single rule that defines how he moves. Any future
one-way edge (a jump-down for a specific enemy, a one-way gate) will land on the
same rake.

**The slice is far too easy, and that is a number problem, not a design one.**
With the placeholder values in the config, a level of six waves is won without
losing a single house. Enemies come in threes and fours against towers that
out-range them, and the hero alone clears wave one before it lands. Nothing about
the loop is wrong; the wave table and the archer's damage are simply untuned, and
tuning is P5. Worth writing down so that "it plays" is not mistaken for "it plays
well".

**Draw calls behave as predicted.** Peak was 372 with 14 units on screen, which is
consistent with the P0 measurement and confirms the instancing plan above -- at
the 40-unit cap with towers and projectiles also drawing, this is the ceiling that
gets hit first.

---

### What P5 actually taught us

**Splitting a wave across two shores makes it EASIER, not harder.** Twin Capes
was authored around section 11's promise that simultaneous opposite landings are
"the natural difficulty curve for a single-hero game: you cannot be in two
places." Measured, the first version of the level was comfortably the *easiest*
of the three -- two archer towers cleared it, against three for level one --
because half a wave arriving at each of two places is half a wave to answer at
each. The split only costs anything if the player has to physically be
somewhere. So the difficulty of a split level is entirely carried by the hero's
travel time, and none of it by the terrain: each half now has to be worth
answering on its own, which is why Twin Capes' waves are sized so that half of
one is about a whole level-one wave.

Everything in this phase was measured with a STATIONARY KING -- the headless
harness never moves him -- so every number here is a floor, and the levels whose
design depends on movement are underrated by exactly the amount the mechanic is
worth.

**The tower tree is currently a trap.** Damage per 100 gold, counting the full
upgrade chain as the cost:

| | cost | dps | dps / 100g |
|---|---|---|---|
| Archer Tower | 40 | 15.7 | **39.1** |
| Fortified | 90 | 15.7 | 17.4 |
| Garrison | 160 | 31.3 | 19.6 |
| Watchtower | 160 | 19.1 | 12.0 |
| Ballista | 100 | 14.3 | 14.3 |
| Twin Ballista | 180 | 28.6 | 15.9 |
| Siege Tower | 180 | 17.1 | 9.5 |

Every upgrade is two to four times worse per gold than simply buying another T1,
and a full T3 costs four T1s while firing twice as much as one. Depth still wins
the level -- an upgrade-first build holds all three, with three or four towers
instead of nine to eleven -- but it finishes with the castle at 200-276 of 420
where the wide build finishes untouched. That gap is what upgrades are paying
for, and it is not obviously worth 4x.

This is structural, not a tuning slip: a fresh tower is always available because
there is no shortage of tiles (section 3 is explicit that gold is the
constraint, never space), so breadth can only lose if depth buys something
breadth cannot. Today that is HP and range, and neither is priced high enough to
matter. Three ways out, and this is a design decision rather than a number to
nudge -- flagged as an open item:

1. **Raise T2/T3 damage** so a T3 lands near a T1's damage per gold, leaving HP
   and range as the reason to prefer it. Keeps section 7's 3-4x cost ratio.
2. **Cut upgrade costs** toward the bottom of section 7's band. Does not close
   the gap on its own: a T3 at 3x still fires 2x.
3. **Take tiles away**, per section 3's own advice, so placement near the fight
   is scarce and depth is forced. Contradicts section 12's "gold is the
   constraint, never space".

**A missing field is an infinite one.** `combat.canHit` reads `spec.range`; the
enemy archer carried its reach as `attackRange`, the melee name. `undefined +
elevationBonus` is NaN, every `d > NaN` is false, and the range band therefore
never rejected anything -- so enemy archers spent the whole of P3 and P4 shooting
the castle from anywhere on the island they had line of sight to. Nothing threw,
nothing warned, and the only visible symptom was that the castle tended to take
either no damage or all 420. The same misread sat in `stepHeroAttacks`, giving
them unlimited range against the king too. combat.js now refuses to construct if
any spec that shoots has no numeric `range`.

**Two deadlocks, both of which held a wave open forever.** Both were found by a
harness that runs whole levels headless and reports any wave that fails to
complete, and neither is reachable by playing carefully:

1. *Diagonal over water.* The unit walks the straight line between two tile
   centres, and the middle of that line lies over the SHOULDER tiles. Separation
   only permitted standing where the rounded tile was land, so at the corner it
   was put back every frame, travelling exactly zero distance forever.

   **The first fix was wrong and had to be reverted.** It made
   `isDiagonalStep` reject a water shoulder -- treating a legal route as
   illegal because standing on it was broken. That is backwards: the shoulders
   describe what is *beside* a crossing, not whether the crossing exists, and a
   player looking at two touching pieces of ground at the same level expects to
   walk between them however the outside of the bend is drawn. It also made
   units refuse corners they visibly should take.

   The real fix is that the corner is a place a unit may legitimately BE.
   `board.isWalkable` recognises the crossing corridor and separation asks it
   instead of `isLand`, so the same predicate governs where a walker may stand
   and -- via `cornerAt` -- how high the ground is there. `isDiagonalStep` is now
   simply "two land tiles, same height, touching at a corner", with no reference
   to the shoulders at all.

   While the strict version was in place it did expose something real: **level
   one's entire north-west shore -- eleven tiles, which boats land on -- had been
   connected to the island only by one sea-crossing diagonal since P0.** It has a
   tile of real ground at (0,6) now, which is a better shoreline regardless.
2. *Flow-field oscillation.* The field answers per tile and the unit walks toward
   the next tile's centre, but the straight line there often leaves the current
   tile first -- and the tile it crosses can point back. Two tiles naming each
   other produced a unit ping-ponging across the boundary at thousandths of a
   tile per frame. Fixed by committing to the chosen waypoint until it is
   actually reached instead of re-asking every frame, which also stopped a crowd
   re-planning every time separation nudged someone over a tile line.

Separation now slides along whichever axis of a rejected move was legal rather
than reverting the whole move, so "this step was illegal" can no longer become
"this unit never moves again".

**Load-time validation earns its keep immediately.** The new checks caught the
orphaned north-west shore and -- on both new levels, before either was ever
played -- house placements that left a whole cape or shore with no legal 2x2 for
the castle.

It also, briefly, caught something that was not a bug. The first version treated
any tier-2 tile on the waterline as an error, on the grounds that boats aimed
down that corridor fall through to the authored fallback. The right answer was to
make the spawner incapable of choosing one: `landingTable` enumerates every angle
that ends at a real beach, once per level, and the spawner picks from that list.
Cliff coast is now an authoring tool rather than a defect, tested on a synthetic
island where 78% of the compass is cliff -- all four boats in a wave landed on
beach, including three that had asked for shores with no beach at all. What
validation still refuses is a coast with almost no beach anywhere, because then
there is nothing to pick from.

The same pass implemented `MIN_LANDING_SEPARATION`, which section 11 has
specified since the first draft and which nothing had ever enforced: boats now
share a tile freely and never share a point.

**rAF is not a fps meter here.** The Browser pane reports
`document.visibilityState === 'visible'` while delivering zero
requestAnimationFrame callbacks per second, so `loop.fps` is meaningless in it
and has been the source of several phantom performance investigations. Driving
the frame by hand instead: **2.3 ms per full frame** -- sim step, all six view
syncs, scene render and grade pass -- with 27 units and 4 boats on The Crown's
last wave, at 99 draw calls and 42,779 triangles. 0.038 ms per sim step. The
instancing of P4 holds on the new levels.

---

### What P6 actually taught us

**The seam had never been used.** Section 17 draws the line as "the simulation
records that things happened, and the presentation layer decides what to do
about them", and the simulation had been holding up its end since P1 -- two
dozen event types, emitted every frame. `main.js` cleared the list unread. So
the boundary the entire architecture is organised around had never once carried
a message, and nothing had ever tested whether the events it carried were the
right ones.

They almost were. Three were missing and all three were the same kind of gap:
the sim recorded *outcomes* but not *actions*. There was no event for a shot
being fired, only for the damage it eventually did; none for an arrow landing,
only for the thing it hit dying; none for a boat grounding, only for the
passengers that walked off it. A game that only makes a noise when something
takes damage reads as unresponsive, because most of what a player does is
release arrows that are still in the air. `shot`, `impact` and `boatLanded`
close that, and `impact` deliberately fires on a MISS as well -- a volley that
thuds into the dirt is feedback too.

**Bursts are the whole problem, and they need two different answers.** Events do
not trickle, they clump: a catapult in a crowd emits one `splash` and six
`unitDied` in a single tick, nine towers volleying emit nine `impact`. Measured
over one wave: 192 footsteps, 149 arrow hits, 138 structure hits.

Audio and camera shake need opposite handling, and using one mechanism for both
would be wrong in one direction or the other:

- **Audio caps and drops.** Per sound, 1 to 6 voices, and over the cap a trigger
  is discarded rather than queued -- a late sound is worse than no sound.
  Verified: 40 `unitDied` in one tick produce 4 voices and release all 4.
- **Shake accumulates then clamps once per frame.** Taking the loudest of six
  simultaneous impacts is right; adding all six sends the camera off the island.

**Never trust an unmeasured mix.** The gains here were guesses, so they were
checked by tapping an analyser onto the master bus and running the busiest wave
in real time. At the first-guess master of 0.55 the peak was 0.40 of full scale
with a mean RMS of 0.031 -- safe, and about 6dB quieter than it wanted to be.
0.70 is the shipped value. Nothing clips at the 40-unit ceiling. Whether it is
*pleasant* remains an ear judgement that no measurement replaces.

Also worth knowing: a coarse sampling loop reported a peak of 0.075 and would
have led to nearly tripling the master. The analyser window is ~21ms and the
loop was sampling every 66ms, so it was observing under a third of the signal
and missing every transient. Sample densely enough to overlap, or do not sample.

**Occlusion is two questions, and they need two different spaces.** Section 15
asks for occluding structures to fade, and "occluding" depends entirely on where
the camera is standing. The test therefore asks:

- *Does the silhouette cover them?* Screen space -- the structure's bounding box
  projected to a rectangle, and the subject's projected position inside it.
- *Are they behind it?* The HORIZONTAL PLANE, along the camera's ground-projected
  forward axis.

The second one started out in view space too, comparing against the nearest
corner of the box, and that shipped a bug: **buildings faded when the player
stood in FRONT of them.** The camera is pitched, so "higher up" and "nearer the
camera" are the same axis -- a tall tower's roof corner is nearer than somebody
standing on the ground at its door, so the tower counted as being between the
camera and the player. Measuring depth in the horizontal plane removes the
building's height from the question entirely, which is the only thing that was
ever wrong with it.

Cost is two matrix transforms per object per frame against forty units and a
dozen structures. A raycast per unit per structure is the same answer for a
hundred times the work, and it could not run against the batched scenery anyway,
which no longer has the object references a raycast needs (section 17).

A short building not fading when somebody stands well behind it is CORRECT, not
a miss: they are visible over its roof, and the screen rectangle says so.

**Set the flags that define a ghost unconditionally, every frame.** The ghost's
material was cloned and configured inside an `if` that only ran when the
material needed creating -- so once the material existed, nothing ever
re-asserted `transparent` or `depthWrite`. When those two were later flipped to
an opaque darkening, the occlusion silently became a dimming: structures still
detected the king perfectly, still left the instanced batch, still drew as their
own mesh, and were still completely solid. Every diagnostic said the feature was
working. `isGhostMaterial` now marks a material as already cloned, and the flags
that make it a ghost are written on every call rather than being a side effect
of construction.

The test for it has to be PACED IN REAL TIME. The camera follow and the fade
both ease against the wall clock, so a tight loop of sixty synthetic frames
advances almost no time at all: the camera never reaches the king, the geometry
under test is not the geometry intended, and the result is a confident,
repeatable, wrong answer. Two separate false bug reports in this file came from
exactly that.

Fading is then free, because the instance buffers are rebuilt from scratch every
frame: an occluding structure is simply left out of its batch and drawn as one
transparent mesh instead. Measured cost is one draw call per occluder, and the
peak across all three levels was four at once.

**The keep had to leave the static batch.** It is pure scenery -- no HP, not a
target -- but it is also the tallest thing on most islands, and section 15 is
unconditional: "if a unit can be attacked, it must be visible. No exceptions."
Batched into the static island it could never be faded, because batching destroys
the object references. It is now flattened to a single mesh in the dynamic root,
which costs one draw call per level. The first screenshot of the finished
occlusion pass showed the castle correctly ghosting and the king still completely
hidden behind the keep's roof, which is exactly the bug the rule exists to
prevent and would have shipped as "occlusion is done".

**A colour flash was not available, and finding out cost an hour.** The obvious
hit reaction is to brighten the instance. three.js r128 supports
`InstancedMesh.setColorAt` and the vertex chunks handle `USE_INSTANCING_COLOR`
correctly -- but `color_pars_fragment` and `color_fragment` guard `vColor` on
`USE_COLOR` alone. The instance colour is therefore computed, written to a
varying the fragment shader never declares, and silently discarded. Nothing
errors. The workaround is to force `vertexColors` on and give every geometry a
white colour attribute; the decision here was to use the transform instead,
since the instancing already writes a matrix per unit per frame and a swell plus
a recoil reads better on chunky low-poly figures than a tint would.

**A cached transform that is only sometimes applied is a frozen one.** The P6
camera shake added an early-out to `placeCamera` for the case where nothing is
shaking. That path also skipped applying a base position recomputed by a yaw
change -- so rotating the camera did nothing at all unless a shake happened to
be active at that moment. It survived P6's own verification because every test
that appeared to prove occlusion worked was moving the HERO between camera
angles, so the results varied for a reason that had nothing to do with the
camera. Occlusion was re-verified afterwards against a camera that genuinely
moves: 24 of 24, with a clean negative control. The lesson is narrower than "test
more" -- it is that a test which varies two things at once cannot tell you which
one it measured.

**Cost of the whole phase: none that can be measured.** 2.12 ms per full frame on
The Crown's last wave -- sim step, event drain, six view syncs, occlusion test,
scene render and grade pass -- with 28 units, 4 boats and 3 structures ghosting.
That is 13% of a 60Hz budget, and indistinguishable from the 2.3 ms measured
before any of P6 existed.

---

## 19. Audio

> **Status: BUILT IN P6.** `src/audio.js` is the system and
> `config.audio` holds every number in it; `src/feedback.js` is the only thing
> that calls it, driven by the event stream. Audio was built in P0, removed
> wholesale, and came back unchanged in shape -- which is the strongest evidence
> the boundary was drawn in the right place. Nothing outside those two files
> knows audio exists, and the game runs identically with the context muted,
> never started, or unavailable entirely.
>
> The plan below is what was built. Where P6 learned something the plan did not
> say, it is in section 18.

**Everything is synthesized at runtime with the Web Audio API. No sample files, no audio assets, no loading step.**

This matches how the rest of the project is built -- the island has no textures and no imported models either, and every material is a handful of numbers. It also keeps the prototype a pure code artifact: nothing to license, nothing to version, nothing to download, and a sound is retuned by changing a constant rather than by opening an editor.

The constraint is real and worth accepting knowingly: synthesis gets you impact, weight and pitch, and it does not get you convincing voices, cloth, or crowds. Nothing in the list below needs those.

### The primitives

Four generators cover the whole game:

- **Noise burst through a filter.** Impacts, arrow hits, footsteps, and the surf. A short exponential amplitude decay on filtered white noise. Sweeping the filter cutoff down over the decay is what separates a thump from a hiss.
- **Pitched blip.** An oscillator with a fast pitch envelope. Coin pickup, UI confirm, build complete. Falling pitch reads as negative, rising as positive -- keep that consistent and the UI teaches itself.
- **Body thump.** A low sine with a steep downward pitch sweep, 90Hz to 40Hz over ~80ms. Tower destruction, brute footfalls, boat landing.
- **Struck tone.** Two or three detuned oscillators sharing an envelope. Bowstring, ballista release, wave-start horn.

Each is a small function taking frequency, duration, and a gain, returning nothing. Every tunable lives in the same config object as everything else (section 17).

### Rules

- **One master gain node** the mute button drives, plus one bus per category (sfx, ui, ambient) so relative levels are tunable in one place.
- **Voice cap and coalescing.** Forty units dying at once must not fire forty voices. Cap concurrent voices per sound type, roughly 4 to 6, and drop rather than queue. Uncapped synthesis clips into distortion, which is the characteristic way a prototype like this fails.
- **Randomize pitch +/-5% and gain +/-10% per trigger.** Identical repeated sounds are what make synthesized audio read as cheap. This costs one line and fixes most of it.
- **Never allocate nodes in the frame loop.** Create on trigger inside the audio system, and let them free themselves on `ended`.
- **AudioContext starts suspended** until the first user gesture. Browsers require it. Resume on the first tap, and treat audio as entirely optional -- the game must run correctly with the context never resumed at all.
- **Positional audio is out of scope.** Stereo pan by screen-space x at most. The camera orbits freely, so anything more elaborate fights the camera rather than helping the player.

### Scope

Prototype needs perhaps a dozen sounds: bow release, arrow hit, melee hit, unit death, tower build, tower destroyed, coin, boat landing, wave start, wave cleared, UI tap, defeat. Ambient surf is one filtered noise loop and is worth having early, because near-silence makes everything else sound thinner than it is.

---

## Open items

- **Is upgrading ever worth the gold?** Measured in P5 (section 18): every
  upgrade is 2-4x worse per gold than another T1, because a fresh tower is always
  available and a full T3 costs four of them while firing twice as much as one.
  Depth wins with a thinner margin, not a fatter one. Three ways out are written
  up there; all three are design decisions, and one of them contradicts section
  12's "gold is the constraint, never space". **This is the largest open question
  in the project** -- until it is answered, the whole tower tree of P4 is content
  the player has no economic reason to buy.
- **The mix is measured, not judged.** P6 verified that nothing clips and that
  every one of the twenty-nine sounds is audible, which is not the same as
  saying any of them sounds good or that the balance between them is right. That
  needs ears. `config.audio` is one block and `master` is one number.
- **Level three's peak is untested as a decision.** Four buildable tiles at tier
  3, the longest reach in the game via section 9's elevation modifier, and no
  castle site up there -- so the enemy never comes to it. Whether that reads as a
  tempting premium spot or as an obvious trap needs a human.
- **Spikes on the Bulwark branch may be dead weight**, since enemies avoid Bulwarks and spikes only trigger on melee attacks. Either extend spikes to damage adjacent walkers, or accept it as the cheap situational pick for sealed layouts. Playtest before deciding.
- **Knockback into cliff edges.** Clamp or fall-with-damage. Defaulting to clamp; falling is more fun but needs a code path.
- Hero damage relative to brute HP. Playtesting, not theory.
- Whether +/- 0.75 per tier elevation range is felt from both directions or needs to be larger.
- Whether the aggro buffer produces clear defender reactions without making enemy groups abandon the castle route too readily. Tune the buffer before adding any further target rules.
- **Castle siting swings difficulty more than tower count does.** With three towers and unlimited gold, a castle on the tier-2 shelf at (5,3) or (4,4) survives level one; the same three towers lose from most other sites, and from the beach at (4,8) they lose two waves early. That is the map-reading decision section 4 asked for, and it is currently a much bigger lever than anything the player buys -- which may be too big.
- **The keep is wearing pure red.** Its accent band is `#c2352f`, the same hue as the king's cape, and it sits on a bright tier where it reads as the loudest thing on the island. Section 15 is unambiguous -- nothing in the environment may enter red, orange, gold or deep maroon -- and this is a direct violation inherited from the diorama, where the band was a deliberate focal accent authored before the hue rule existed. Either recolour the band to stone or cool slate, or accept that the king needs to be larger and brighter to win the comparison. Decide before the art pass is called finished; it is a one-line change either way.
- Whether archer range 4.5 is too short to feel useful at T1. Rescaled with the board, so the question is unchanged, not resolved.
- Whether the reference island's ~55 buildable tiles is too *many*. The original worry pointed the other way; the art settled it in this direction. Tune via water coverage per level. P5 makes this urgent rather than academic: tile abundance is precisely why breadth beats depth.
- **Twin Capes may reward turtling on one cape too heavily.** One ramp per cape means a castle up there faces a single chokepoint, and the headless runs never lost a house to it because a stationary king holds the ramp. The intended cost is the far cape's house and the exposed east one, but only a moving player pays it.

## Decided

**Enemy size is one dial, and it moves art only.** `UNIT_SIZE_MULTIPLIER` in
`rigs.js` scales every enemy rig; the simulation's push and hit radii are
authored separately in config and are deliberately not tied to it, so raising it
changes how big raiders look without changing how they crowd, path or fight.

**The gap between the two is now worth watching.** Two grunts pressed to the
separation minimum sit `2 x pushRadius` = 0.16 tiles apart, with `2 x` their
0.116-tile shoulder half-width = 0.232 tiles of shoulder between them: they
interpenetrate by **0.060 of a tile**. The dial has gone 1.15 -> 1.265 -> 1.3915
and the bodies were widened and then given half of that widening back, taking
the overlap 0.016 -> 0.034 -> 0.072 -> 0.060. It still passes as a
shoulder-to-shoulder horde, and the next increase
is the one that wants `config.unit.pushRadius` raised with it -- which is a
gameplay change, not an art one, since push radius sets how densely a wave packs
into a chokepoint.

*(An earlier revision of this paragraph quoted "under two percent of a tile". It
compared half-width against push radius directly and forgot that both units
move; the pairwise figures above are the right ones.)*

**The grunt reads by mass and by one bright mark, not by size.** Rebuilt stocky
and lightly stooped, with a round shield whose iron boss is the accent; see
section 15.
The alternative on the table was a warm accent on the *archer*, which would have
worked equally well for telling the two apart but would have spent the colour
budget on the unit that already had a distinctive shape in the bow. Cost: four
extra InstancedMeshes, which is four draw calls for the type rather than per
unit. Forty grunts still hold 60 fps.

- **A level change rebuilds the world rather than resetting it.** Board, terrain
  mesh, water shader, flow fields, picker and batched scenery are all baked
  against one board, so `main.js` builds a second everything and disposes the
  first. Levels change a handful of times per session and the build costs a few
  milliseconds; a reset path through nine systems, exercised twice a session,
  would be paying real risk to save nothing.
- **Wave tables live per level**, keyed by level id in `config.waves.levels`, not
  as one global escalation. A level's waves are a property of where its shores
  are.
- **Board is 10x10, not 8x8.** The art was built and tuned at 10x10 and the camera framing derives from it. All ranges rescaled ~1.15x (section 5).
- **Ramps are explicit tile-pairs**, not glyphs with inferred direction (section 3).
- **No hero abilities.** Tap-to-move is the whole combat input; the mock's VOLLEY / RALLY / HOLD are superseded (section 13).
- **All animation is procedural**, driven from a distance-based gait phase. No skeletons, no clips (section 15).
- **All audio is synthesized at runtime.** No sample files (section 19).
- **The game does not live in the design-canvas shell.** ES modules over HTTP (section 17).
