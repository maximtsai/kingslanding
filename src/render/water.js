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

  // The sky is this material, not scene.background: the plane is 320 units
  // across and covers the whole frame, so the renderer's clear colour is never
  // seen. Anything that wants to change the sky has to change these uniforms.
  return {
    fadeMaterial,
    skyMaterial: waterMat,
    // Fed the frame delta, not a running total: wrapping here is what keeps the
    // argument to sin() small forever. See WAVE_PERIOD.
    advance(dt) { waveTime.value = (waveTime.value + dt) % WAVE_PERIOD; }
  };
}
