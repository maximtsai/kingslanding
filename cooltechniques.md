# Cool Techniques

Write-ups of non-obvious rendering tricks in this project. Each one explains the
constraint that forced it, so a future change can tell whether the constraint
still holds.

---

## Animated sea foam

**Where:** `src/render/water.js` — `makeSurfMaterial`, `shorelineRing`.
**Cost:** 276 vertices, one draw call, no textures, vertex shader only.

Surf that runs around the island's coastline and swells in and out, on a budget
that allows no textures, no extra passes, and no per-frame geometry rebuilds.

### The constraint

The shoreline was already two static rings of quads, built once at level load
from the terrain's own tier-1 contour: a wide soft `shallow` halo, and a thin
white `foam` line on the sand. `offsetLoop` pushes the contour inward and
outward by fixed distances and the ring is the strip between them.

Two things ruled out the obvious approaches:

- **No textures anywhere on the water.** A scrolling foam texture would have
  been the only texture fetch in the scene, on geometry that hugs the whole
  coastline.
- **The ring is built once and batched.** Rebuilding its geometry each frame to
  animate the shape would undo that.

So the animation has to live entirely in a shader, driven by attributes baked in
at build time.

### 1. Normalised arc length is the whole trick

The ring is a strip, so every vertex sits on either the shoreward or the seaward
edge. Walking the inner loop and accumulating segment lengths gives each vertex
its distance around the coast; dividing by the perimeter normalises that to
`0..1` and stores it as `aAlong`.

Normalising is what makes the effect composable. Because `aAlong` always spans
exactly one unit, a **whole number** of crests closes seamlessly on any loop, no
matter how long its perimeter — so the crest count can live in the material as a
uniform instead of being baked per geometry. One material drives every island.

```glsl
float wave = sin(aAlong * 6.2831853 * uCrests - uTime * uRate);
```

With `uCrests` an integer, `sin` at `aAlong = 1` equals `sin` at `aAlong = 0`.
No seam.

**The seam has one gotcha.** The closing quad spans from the last vertex back to
the first. Its far edge must be given a full `1.0`, not the `0.0` that the
wrapped index would naturally produce — otherwise the last quad's phase runs
backwards across the join and one crest plays in reverse. Hence the `along`
array carries `inner.length + 1` entries, the final one being the full
perimeter.

### 2. Animate the width, not the colour

The first version modulated alpha: crests opaque, troughs faded. It reads as the
foam changing *colour*, which is wrong — surf is white, and what actually moves
is how far up the sand it reaches.

The fix is to displace geometry instead. A second attribute, `aPush`, holds the
unit seaward direction at each **outer** vertex and `(0, 0)` at every inner one:

```glsl
vec3 p = position;
p.xz += aPush * uSwell * wave;
```

Because only the seaward edge carries a push, the band breathes wider and
narrower against a **fixed coastline**. Push both edges and the whole ring
slides out to sea, which looks like the island shrinking. The fragment shader
then does nothing but output a flat opaque white — there is no alpha term left
to vary, so the colour genuinely cannot move.

**Take each vertex's normal from its own inner partner, not from the segment.**

```js
const seaward = k => {
  const dx = outer[k][0] - inner[k][0], dz = outer[k][1] - inner[k][1];
  const length = Math.hypot(dx, dz) || 1;
  return [dx / length, dz / length];
};
```

This is exact, not an approximation. `offsetLoop` is a mitre offset: it averages
the two adjacent edge normals into a bisector and moves the original point along
it. Both loops therefore place vertex `k` at `p + miter * scale`, differing only
in the signed scale — so `outer[k] - inner[k]` is *always* parallel to the mitre,
and normalising it recovers the bisector precisely. Even where `offsetLoop`
clamps the scale at a sharp corner, both ends clamp along the same direction.

Using a segment normal instead would push the two sides of a corner in different
directions and pinch the band where they meet.

### 3. Wrap the clock, and match the wrap to the rate

`sin()` of an ever-growing float goes visibly jittery on mediump mobile fragment
hardware after a few minutes of play. So the clock wraps:

```js
const WAVE_RATE = 1.0;
const WAVE_PERIOD = (Math.PI * 2) / WAVE_RATE;
// ...
advance(dt) { waveTime.value = (waveTime.value + dt) % WAVE_PERIOD; }
```

`WAVE_PERIOD` is exactly one whole cycle of `WAVE_RATE`, so every term crosses
the wrap on a full cycle and nothing jumps.

**This is easy to get wrong.** An earlier version simplified `uRate` out of the
shader, leaving it advancing at an implied 1 rad/s while the clock still wrapped
for 0.7 — a visible jump in the surf every ~9 seconds. The bug is invisible in a
still and easy to miss in motion; it was caught by evaluating the phase function
either side of the wrap and diffing:

```
maxWrapError: 1.67   (broken)
maxWrapError: 3.8e-15 (fixed — machine epsilon)
```

If you retune the rate, `WAVE_PERIOD` follows automatically because it is
derived. Do not hardcode it.

`advance(dt)` takes the **frame delta**, not a running total — the accumulation
and the wrap both belong in one place. It is fed from `render(alpha, elapsed)`
in `main.js`, whose `elapsed` is a delta, via `scene.advanceWater`.

### 4. Numbers that matter

The band runs from `-0.025` (inside the coastline) to `0.072` (out to sea), so
it is `0.097` wide at rest. `uSwell` of `0.060` gives:

| | width |
|---|---|
| crest | 0.157 |
| trough | 0.037 |

A 4.2× swing. The trough deliberately keeps `0.037` of white on the sand: let it
reach zero and the line breaks into dashes and the coastline appears to move.
Six crests at 1.0 rad/s lap the island in about 38 seconds.

`uSwell` is multiplied by a `swell` factor that `gpuTier().weak` sets to 0, so a
weak device gets the same white band frozen at its resting width — the same dial
that already gates pixel ratio and MSAA.

### Historical note

The foam ring used to be half as wide, because the lowest terrain tier's cliff
face was panelled and the top row of those panels laid a bright bevel right along
the waterline that was doing half the work of reading as surf. That panelling was
removed (it detailed a 0.05-tall sliver above water and drowned the rest — 900
triangles), which is what exposed how thin the actual foam ring was. If the shore
ever looks bare again, check whether something else was incidentally lighting it
before reaching for a wider ring.

### Reusing this

The pattern generalises to anything drawn as a closed strip that should animate
along its length: a ring of fire, a pulsing selection outline, a river edge.
What you need is:

1. A strip with a distinguishable inner and outer edge.
2. `aAlong` — normalised arc length, with the closing vertex at `1.0`.
3. An integer count of features, so the loop closes seamlessly.
4. A displacement direction attribute that is zero on the edge that must stay put.
5. A wrapped clock whose period is one whole cycle of the rate.
