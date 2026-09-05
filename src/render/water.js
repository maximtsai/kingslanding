// Island diorama -- the sea.
//
// The water plane doubles as the backdrop, so there is no skybox: one unlit quad
// carries a screen-vertical gradient, and the shoreline is two offset rings taken
// straight off the terrain's own tier-1 contour.

import * as D from './util.js';


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

export function buildWater(ctx) {
  const { THREE, P, scene, footprints } = ctx;
  const { offsetLoop, signedArea } = D;

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
    const geometry = new THREE.BufferGeometry(), positions = [], fade = [];
    const push = (p, a) => { positions.push(p[0], y, p[1]); fade.push(a); };
    for (let i = 0; i < inner.length; i++) {
      const n = (i + 1) % inner.length;
      push(inner[i], 1); push(outer[i], 0); push(outer[n], 0);
      push(inner[i], 1); push(outer[n], 0); push(inner[n], 1);
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (faded) geometry.setAttribute('aFade', new THREE.Float32BufferAttribute(fade, 1));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = faded ? -1 : 0;
    scene.add(mesh);
  }

  const fadeMaterial = makeFadeMaterial(THREE);
  const haloMat = fadeMaterial(P.shallow, 0.6);
  const foamMat = new THREE.MeshBasicMaterial({ color: P.foam, side: THREE.DoubleSide, fog: false });
  // A wide soft halo of shallows, then a thin crisp line of surf on the sand.
  footprints[1].filter(loop => signedArea(loop.points) > 0).forEach(loop => {
    shorelineRing(loop, 0.1, 0.66, 0.028, haloMat, true);
    shorelineRing(loop, -0.025, 0.045, 0.05, foamMat, false);
  });

  // The sky is this material, not scene.background: the plane is 320 units
  // across and covers the whole frame, so the renderer's clear colour is never
  // seen. Anything that wants to change the sky has to change these uniforms.
  return { fadeMaterial, skyMaterial: waterMat };
}
