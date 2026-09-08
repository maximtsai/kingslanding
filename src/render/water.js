// Island diorama -- the sea.
//
// The water plane doubles as the backdrop, so there is no skybox: one unlit quad
// carries a screen-vertical gradient, and the shoreline is two offset rings taken
// straight off the terrain's own tier-1 contour.

import * as D from './util.js';


// The surf's clock rate. WAVE_PERIOD is exactly one whole cycle of it, which
// is what lets the clock wrap invisibly -- and it has to wrap: sin() of an
// ever-growing float goes visibly jittery on mediump mobile hardware after a
// few minutes of play.
const WAVE_RATE = 1.0;
const WAVE_PERIOD = (Math.PI * 2) / WAVE_RATE;

// Anything painted flat on the water uses this: a solid tint whose alpha is
// driven by a per-vertex ramp, so edges dissolve instead of ending on a seam.
function makeFadeMaterial(THREE) {
  return (color, opacity) => new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
    vertexShader: [
      'attribute float aFade; varying float vFade;',
      'void main(){ vFade = aFade; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 uColor; uniform float uOpacity; varying float vFade;',
      'void main(){ gl_FragColor = vec4(uColor, uOpacity * vFade * vFade); }'
    ].join('\n'),
    transparent: true, depthWrite: false, side: THREE.DoubleSide
  });
}

// Surf that travels around the coast instead of pulsing in unison -- the
// difference between reading as waves and reading as a blinking outline.
//
// `aAlong` is arc length NORMALISED to 0..1, which is what lets the crest count
// live in the material rather than being baked per geometry: a whole number of
// crests closes seamlessly on any loop, however long its perimeter.
// The colour never moves. The surf is one flat white, and what animates is how
// far it reaches: `aPush` is the seaward direction at each OUTER vertex and zero
// on the shoreward edge, so displacing along it makes the band breathe wider and
// narrower against a fixed coastline rather than sliding bodily out to sea.
function makeSurfMaterial(THREE, time) {
  return (color, crests, swell) => new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uCrests: { value: crests },
      // Explicit, and it must match WAVE_PERIOD: the clock wraps at exactly one
      // whole cycle of THIS rate, so leaving the shader to advance at an implied
      // 1 rad/s would put a visible jump in the surf on every wrap.
      uRate: { value: WAVE_RATE },
      uSwell: { value: swell },
      uTime: time
    },
    vertexShader: [
      'attribute float aAlong; attribute vec2 aPush;',
      'uniform float uCrests, uRate, uSwell, uTime;',
      'void main(){',
      ' float wave = sin(aAlong * 6.2831853 * uCrests - uTime * uRate);',
      ' vec3 p = position;',
      ' p.xz += aPush * uSwell * wave;',
      ' gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 uColor;',
      'void main(){ gl_FragColor = vec4(uColor, 1.0); }'
    ].join('\n'),
    side: THREE.DoubleSide
  });
}

// The open sea, as twenty pointed crests that surface, spread, and sink again.
//
// One merged geometry, one draw call, forty triangles. The alternative --
// a wave field in the water plane's own fragment shader -- costs no geometry at
// all but pays for itself on every pixel of the frame, since that plane covers
// all of them. batch.js exists because this diorama's budget is draw calls and
// fill, not vertices, so the cheap-looking option is the expensive one here.
const CREST_COUNT = 20;
// Local outline of a crest at size 1, in world units. Three sharp points -- two
// tips and the apex -- and no curve anywhere: the shape is the whole read, so
// it is authored rather than derived from a sine.
const CREST_LENGTH = 0.95;    // tip to tip, halved
const CREST_PEAK = 0.44;      // how far the apex juts ahead of the tips
const CREST_THICK = 0.17;     // apex thickness, tapering to nothing at the tips
const CREST_SIZE_MIN = 0.70;
const CREST_SIZE_MAX = 1.10;
// The tips finish their spread slightly ahead of the apex, so a crest SHARPENS
// as it rises rather than merely inflating. Shared with the vertex shader by
// substitution below -- the clearance maths depends on the same number, and two
// copies of it would drift.
const TIP_STRETCH = 0.16;
// One heading for the whole sea. Real swell arrives in parallel, and crests
// pointing twenty ways read as debris rather than as water; the jitter
// is what keeps that from looking stamped.
const SWELL_HEADING = -0.62 + Math.PI;   // apexes face the opposite shore
const SWELL_SPREAD = 0.34;
// Clear of the coast: past the surf ring's outer edge (0.090) and the shallows
// halo (0.66) with room to spare, so a crest never crowds the shoreline.
const SHORE_CLEARANCE = 0.9;
// The band a crest may surface in, measured out from the island's own extent.
// Near enough to read as this island's water, far enough to leave the surf its
// own space.
const CREST_NEAR = 1.6;
const CREST_FAR = 7.0;
// The largest a crest can ever get, which is the radius every candidate spot is
// cleared for -- so any crest may take any spot without a second test.
const CREST_REACH = Math.max(CREST_LENGTH, CREST_PEAK) * CREST_SIZE_MAX * (1 + TIP_STRETCH);
// Candidate spots, validated once at build time. Respawning picks from this
// pool rather than testing the coastline live: the polygon test is the whole
// cost, and doing it up front means a respawn can never stall a frame or fail
// and drop a wave on the sand.
const SPOT_POOL = 72;
// Keeps two live crests from surfacing on top of each other. Deliberately
// modest: at twenty crests a wider ring than this saturates the band, and a
// respawn that cannot find a free spot has to settle for a worse one. Crests
// this close still rarely overlap, because their lives are staggered and one is
// shrinking while the other grows.
const CREST_SPACING = 1.7;
const CREST_Y = 0.03;

// A crest's whole life is one scale ramp: nothing, out to full spread, back to
// nothing. It is reseated at a new spot at the instant it is at zero, so the
// move is never seen -- there is no geometry on screen to move.
function makeCrestMaterial(THREE, time, base, swell) {
  return new THREE.ShaderMaterial({
    uniforms: {
      // The SAME uniform object the sky gradient uses, not a copy of its value.
      // The evening blend in renderer.js mutates that colour in place, so
      // sharing the reference is what keeps the crests in step with dusk
      // without any wiring of their own -- and what stops them glowing at night
      // the way a hard-coded white would.
      uBase: base,
      uInvPeriod: { value: 1 / WAVE_PERIOD },
      uSwell: { value: swell },
      uTime: time
    },
    vertexShader: [
      'attribute vec2 aLocal; attribute float aPhase; attribute float aTip;',
      'uniform float uInvPeriod, uSwell, uTime;',
      'void main(){',
      // One life per crest, 0..1. The clock wraps at exactly WAVE_PERIOD, so
      // uTime * uInvPeriod runs 0..1 and the wrap lands somewhere harmless in
      // every crest's life instead of resetting them all at once.
      ' float life = fract(uTime * uInvPeriod + aPhase);',
      // sin() over one half-turn: zero at birth, full at mid-life, zero again.
      // A weak device holds every crest at a fixed spread instead -- uSwell is
      // 0 or 1, so the mix is exact and costs no branch.
      ' float grow = mix(0.8, sin(life * 3.14159265), uSwell);',
      ' vec3 p = position;',
      ' p.xz += aLocal * (grow * (1.0 + ' + TIP_STRETCH.toFixed(2) + ' * aTip * grow));',
      ' gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 uBase;',
      // Fully opaque: a lift off the sea's own colour rather than a blend into
      // it, so the edge stays hard at every zoom and there is nothing to sort.
      'void main(){ gl_FragColor = vec4(mix(uBase, vec3(1.0), 0.30), 1.0); }'
    ].join('\n'),
    side: THREE.DoubleSide
  });
}

export function buildWater(ctx) {
  const { THREE, P, scene, footprints } = ctx;
  const { offsetLoop, signedArea } = D;

  // The surf's clock, advanced by advance() below.
  const waveTime = { value: 0 };
  // The one dial that turns the motion off. gpuTier already gates pixel ratio
  // and MSAA; a weak device gets the same surf line, just standing still.
  const swell = D.gpuTier().weak ? 0 : 1;

  // A screen-vertical gradient (cool overhead, warm pale toward the viewer) with
  // a soft pool of light around the island. Two triangles for the entire sky.
  const waterMat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(P.skyTop) },
      uBottom: { value: new THREE.Color(P.skyBottom) },
      uPool: { value: new THREE.Color(P.water) }
    },
    vertexShader: [
      'varying vec2 vScreen;',
      'varying vec2 vPlane;',
      'void main(){',
      ' vec4 world = modelMatrix * vec4(position, 1.0);',
      ' vPlane = world.xz;',
      ' vec4 clip = projectionMatrix * viewMatrix * world;',
      ' vScreen = clip.xy / clip.w * 0.5 + 0.5;',
      ' gl_Position = clip;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 uTop, uBottom, uPool;',
      'varying vec2 vScreen;',
      'varying vec2 vPlane;',
      'void main(){',
      ' float t = smoothstep(0.0, 1.0, clamp(vScreen.y, 0.0, 1.0));',
      ' vec3 c = mix(uBottom, uTop, t);',
      ' c = mix(c, uPool, (1.0 - smoothstep(1.5, 19.0, length(vPlane))) * 0.6);',
      // Dither: a ramp this large bands badly in 8 bits without it.
      ' float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);',
      ' gl_FragColor = vec4(c + (n - 0.5) * 0.007, 1.0);',
      '}'
    ].join('\n')
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.frustumCulled = false;
  scene.add(water);

  // `faded` rings carry a per-vertex alpha ramp so the outer edge dissolves into
  // open water instead of ending on a visible seam.
  function shorelineRing(loop, innerDistance, outerDistance, y, material, faded) {
    const inner = offsetLoop(loop.points, innerDistance), outer = offsetLoop(loop.points, outerDistance);
    // Cumulative arc length around the inner edge, normalised. The closing vertex
    // is given a full perimeter rather than folding back to zero, or the surf
    // would run backwards across the seam where the loop meets itself.
    const along = [0];
    for (let i = 0; i < inner.length; i++) {
      const n = (i + 1) % inner.length;
      along.push(along[i] + Math.hypot(inner[n][0] - inner[i][0], inner[n][1] - inner[i][1]));
    }
    const perimeter = along[inner.length] || 1;
    // Unit seaward direction at each outer vertex, taken from that vertex's own
    // inner partner rather than from the segment, so a corner pushes along its
    // own normal and the band keeps an even width around one.
    const seaward = k => {
      const dx = outer[k][0] - inner[k][0], dz = outer[k][1] - inner[k][1];
      const length = Math.hypot(dx, dz) || 1;
      return [dx / length, dz / length];
    };
    const STILL = [0, 0];
    const geometry = new THREE.BufferGeometry();
    const positions = [], fade = [], arc = [], shove = [];
    const push = (p, a, s, d) => {
      positions.push(p[0], y, p[1]); fade.push(a); arc.push(s / perimeter); shove.push(d[0], d[1]);
    };
    for (let i = 0; i < inner.length; i++) {
      const n = (i + 1) % inner.length;
      const di = seaward(i), dn = seaward(n);
      push(inner[i], 1, along[i], STILL); push(outer[i], 0, along[i], di); push(outer[n], 0, along[i + 1], dn);
      push(inner[i], 1, along[i], STILL); push(outer[n], 0, along[i + 1], dn); push(inner[n], 1, along[i + 1], STILL);
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aAlong', new THREE.Float32BufferAttribute(arc, 1));
    geometry.setAttribute('aPush', new THREE.Float32BufferAttribute(shove, 2));
    if (faded) geometry.setAttribute('aFade', new THREE.Float32BufferAttribute(fade, 1));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = faded ? -1 : 0;
    scene.add(mesh);
  }

  const fadeMaterial = makeFadeMaterial(THREE);
  const haloMat = fadeMaterial(P.shallow, 0.6);
  // Six crests running the coast, each reaching 0.074 further in and out against
  // a band 0.120 wide -- so the surf swells to roughly four times its narrowest
  // and the movement is the point rather than a detail. The trough still leaves
  // 0.046 of white on the sand, so the line never breaks up into dashes.
  //
  // The swell is scaled with the band whenever the band changes, or a wider surf
  // quietly reads as a calmer one.
  const foamMat = makeSurfMaterial(THREE, waveTime)(P.foam, 6, 0.074 * swell);
  // A wide soft halo of shallows, then the surf line on the sand.
  //
  // The surf reaches further out than it did (0.045 -> 0.072). The lowest tier's
  // cliff face used to be panelled, and the top row of those panels laid a bright
  // bevel along the waterline that was doing half the work of reading as surf.
  // That panelling is gone -- it was detailing a sliver and drowning the rest --
  // so the ring actually meant to be surf has to carry the shore on its own.
  footprints[1].filter(loop => signedArea(loop.points) > 0).forEach(loop => {
    shorelineRing(loop, 0.1, 0.66, 0.028, haloMat, true);
    shorelineRing(loop, -0.030, 0.090, 0.05, foamMat, false);
  });

  // ---- open sea ----
  // Crests surface outside the coastline, never on it. Land is the tier-1
  // contour -- the same loops the surf is drawn from -- and a spot has to clear
  // it by the largest radius any crest can reach, not merely fall outside it,
  // or half a wave ends up on sand.
  const land = footprints[1].filter(loop => D.signedArea(loop.points) > 0);
  // A stream of its own, NOT ctx.rand. scene.js is explicit that every builder
  // draws from one shared PRNG and that inserting a call shifts everything
  // downstream, so drawing from it here would reshuffle every structure and
  // tree on the island.
  const random = D.rng(0x5eac1f);

  // The island's own extent, so crests surface off the coast of whichever level
  // is loaded rather than at a distance tuned for one of them.
  let landRadius = 0;
  land.forEach(loop => loop.points.forEach(p => {
    landRadius = Math.max(landRadius, Math.hypot(p[0], p[1]));
  }));

  const spotClear = (x, z) => land.every(loop =>
    !D.pointInPolygon([x, z], loop.points) &&
    D.distanceToLoop([x, z], loop.points) > CREST_REACH + SHORE_CLEARANCE);

  // Flat, not an array of pairs: this is read on every crowding test and a
  // typed array keeps the whole pool in two cache lines instead of scattering
  // it across as many little arrays as there are spots.
  const spots = new Float32Array(SPOT_POOL * 2);
  let spotCount = 0;
  for (let tries = 0; tries < SPOT_POOL * 40 && spotCount < SPOT_POOL; tries++) {
    const angle = random() * Math.PI * 2;
    const distance = landRadius + CREST_NEAR + random() * (CREST_FAR - CREST_NEAR);
    const x = Math.cos(angle) * distance, z = Math.sin(angle) * distance;
    if (spotClear(x, z)) { spots[spotCount * 2] = x; spots[spotCount * 2 + 1] = z; spotCount++; }
  }

  // Four vertices per crest, not six. The kite is two triangles that share the
  // apex-to-back edge, so an index buffer draws it from four corners -- a third
  // less vertex data to hold and, more to the point, a third less to rewrite
  // and re-upload every time a crest is reseated.
  const CORNERS = 4;
  const CREST_ORDER = [0, 1, 3, 1, 2, 3];
  const positions = new Float32Array(CREST_COUNT * CORNERS * 3);
  const local = new Float32Array(CREST_COUNT * CORNERS * 2);
  // How much of the tip stretch each corner takes: the tips finish ahead of the
  // apex, so the crest sharpens as it rises. Same for every crest, so this and
  // the phase below are written once at build and never touched again -- they
  // are not part of what a reseat changes.
  const CORNER_TIP = [1, 0.45, 1, 0];
  const tips = new Float32Array(CREST_COUNT * CORNERS);
  const phases = new Float32Array(CREST_COUNT * CORNERS);
  const indices = new Uint16Array(CREST_COUNT * CREST_ORDER.length);
  // Per crest: which spot it is on, how big this life is, and which way it
  // faces. Phase is fixed for the run -- it is the stagger, and re-rolling it
  // on every respawn would let the crests drift into step.
  const crests = [];
  const lastLife = new Float32Array(CREST_COUNT);

  // Writes one crest's four corners from its current spot, size and heading.
  // Position and aLocal only: everything else about a crest is build-time.
  function writeCrest(index) {
    const c = crests[index];
    const sx = spots[c.spot * 2], sz = spots[c.spot * 2 + 1];
    const length = CREST_LENGTH * c.size, peak = CREST_PEAK * c.size, thick = CREST_THICK * c.size;
    // Two tips, an apex, and the back of the apex: a kite with three sharp
    // points and no rounded edge to soften at any zoom.
    const outline = [
      -length, 0,                 // left tip
      0, peak,                    // apex
      length, 0,                  // right tip
      0, peak - thick             // back of the apex
    ];
    const cos = Math.cos(c.heading), sin = Math.sin(c.heading);
    for (let n = 0; n < CORNERS; n++) {
      const lx = outline[n * 2], lz = outline[n * 2 + 1];
      const v = index * CORNERS + n;
      positions[v * 3] = sx;
      positions[v * 3 + 1] = CREST_Y;
      positions[v * 3 + 2] = sz;
      local[v * 2] = lx * cos - lz * sin;
      local[v * 2 + 1] = lx * sin + lz * cos;
    }
  }

  // How a candidate spot rates against the crests already out there. Two
  // separate answers, because they are not equally bad: sharing a spot exactly
  // stacks two crests into one shape and is never acceptable, while merely
  // sitting close is usually invisible, since staggered lives mean one is
  // shrinking while the other grows.
  //
  // Compares SQUARED distances -- this is the one thing here that runs in a
  // loop inside a loop, and the ordering it needs is the same either way.
  const CREST_SPACING_SQ = CREST_SPACING * CREST_SPACING;
  const TAKEN = 2, CLOSE = 1, FREE = 0;
  function rateSpot(index, candidate) {
    const cx = spots[candidate * 2], cz = spots[candidate * 2 + 1];
    let rating = FREE;
    for (let k = 0; k < crests.length; k++) {
      const other = crests[k];
      if (k === index || other.spot === null) continue;
      if (other.spot === candidate) return TAKEN;
      const dx = spots[other.spot * 2] - cx, dz = spots[other.spot * 2 + 1] - cz;
      if (dx * dx + dz * dz < CREST_SPACING_SQ) rating = CLOSE;
    }
    return rating;
  }

  // A fresh spot, size and heading, taken at the instant the crest is at zero
  // scale. Takes the first free spot it finds; failing that it falls back to
  // the best it saw rather than looping, and a spot another crest is already
  // sitting on is never the answer.
  function reseat(index) {
    const c = crests[index];
    let choice = c.spot === null ? 0 : c.spot;
    let best = TAKEN + 1;
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = Math.min(spotCount - 1, Math.floor(random() * spotCount));
      if (candidate === c.spot) continue;
      const rating = rateSpot(index, candidate);
      if (rating < best) { best = rating; choice = candidate; }
      if (rating === FREE) break;
    }
    c.spot = choice;
    c.size = CREST_SIZE_MIN + random() * (CREST_SIZE_MAX - CREST_SIZE_MIN);
    c.heading = SWELL_HEADING + (random() - 0.5) * 2 * SWELL_SPREAD;
    writeCrest(index);
  }

  for (let i = 0; i < CREST_COUNT; i++) {
    // Evenly staggered lives, so at any moment the sea has crests at every
    // stage rather than all of them rising and falling together.
    const phase = (i + random() * 0.6) / CREST_COUNT;
    crests.push({ spot: null, size: 1, heading: SWELL_HEADING, phase });
    lastLife[i] = phase % 1;
    for (let n = 0; n < CORNERS; n++) {
      tips[i * CORNERS + n] = CORNER_TIP[n];
      phases[i * CORNERS + n] = phase;
    }
    for (let n = 0; n < CREST_ORDER.length; n++) {
      indices[i * CREST_ORDER.length + n] = i * CORNERS + CREST_ORDER[n];
    }
    reseat(i);
  }

  const crestGeometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  const localAttribute = new THREE.BufferAttribute(local, 2);
  // Only these two change; three.js can keep the rest in static VRAM.
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  localAttribute.setUsage(THREE.DynamicDrawUsage);
  crestGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
  crestGeometry.setAttribute('position', positionAttribute);
  crestGeometry.setAttribute('aLocal', localAttribute);
  crestGeometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  crestGeometry.setAttribute('aTip', new THREE.BufferAttribute(tips, 1));
  // uBottom, not uPool: the crests sit low in the frame, where the gradient has
  // already run to its bottom colour, so that is the water they have to lift off.
  const crestMesh = new THREE.Mesh(
    crestGeometry, makeCrestMaterial(THREE, waveTime, waterMat.uniforms.uBottom, swell));
  // The spots move and three.js computes a bounding sphere once, so culling
  // against a stale one would blink a crest out at the edge of the frame. At
  // forty triangles there is nothing to save by culling anyway.
  crestMesh.frustumCulled = false;
  scene.add(crestMesh);

  // Reseat any crest whose life has just wrapped. Called once a frame, but only
  // touches geometry at the instant a crest is at zero scale -- across all of
  // them that is a few times a second, four corners each.
  function cycleCrests() {
    let moved = false;
    const turn = waveTime.value / WAVE_PERIOD;
    for (let i = 0; i < CREST_COUNT; i++) {
      const life = (turn + crests[i].phase) % 1;
      // The clock's own wrap is NOT a life wrap: at waveTime = WAVE_PERIOD the
      // ratio is 1 and fract(1 + phase) is phase, exactly where the life
      // restarts. So this fires only when a crest reaches the end of its ramp.
      if (life < lastLife[i]) { reseat(i); moved = true; }
      lastLife[i] = life;
    }
    if (moved) {
      positionAttribute.needsUpdate = true;
      localAttribute.needsUpdate = true;
    }
  }

  // The sky is this material, not scene.background: the plane is 320 units
  // across and covers the whole frame, so the renderer's clear colour is never
  // seen. Anything that wants to change the sky has to change these uniforms.
  return {
    fadeMaterial,
    skyMaterial: waterMat,
    // Fed the frame delta, not a running total: wrapping here is what keeps the
    // argument to sin() small forever. See WAVE_PERIOD.
    advance(dt) {
      waveTime.value = (waveTime.value + dt) % WAVE_PERIOD;
      // A weak device holds every crest at a fixed spread (see the material),
      // so there is no life to wrap and nothing to reseat.
      if (swell) cycleCrests();
    }
  };
}
