// Hero TD -- renderer, camera, lighting and the grade pass.
//
// Everything that is not scene content. Ported from the diorama's entry point;
// the scene assembly that used to sit alongside it now lives in scene.js, and
// the boot/polling machinery the design-canvas host required is gone entirely.
//
// The camera is orthographic on purpose (TDD 14): elevation tiers read cleanly
// without perspective shear, and the frustum is expressed in board widths so a
// different map size frames itself without retuning.

import { palette } from './palette.js';
import { gpuTier } from './util.js';
import { config } from '../config.js';

export function createRenderer(THREE, host, board) {
  const C = config.camera;
  const W = () => host.clientWidth || 720;
  const H = () => host.clientHeight || 1280;

  const tier = gpuTier();
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: !tier.weak,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true
    });
  } catch (error) {
    renderer = new THREE.WebGLRenderer({ stencil: false, depth: true });
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, tier.weak ? 1 : (tier.mobile ? 1.5 : 2)));
  renderer.shadowMap.enabled = false;               // TDD 15: no cast shadows anywhere
  renderer.outputEncoding = THREE.sRGBEncoding;

  const canvas = renderer.domElement;
  canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.skyTop);
  // A whisper of aerial perspective: the far side of the island settles into haze.
  scene.fog = new THREE.Fog(palette.haze, 44, 118);

  // ---------------- camera ----------------
  const view = { yaw: C.YAW_START, frustum: board.FRAME * C.FRUSTUM_START };

  // Button-driven rotation eases to its destination; dragging stays 1:1 with the
  // finger. A tween on a drag reads as input lag rather than as polish, so the
  // two paths are deliberately different.
  const Cubic = { easeOut: t => 1 - Math.pow(1 - t, 3) };
  let rotateTween = null;
  const ZOOM_MIN = board.FRAME * C.ZOOM_MIN;
  const ZOOM_MAX = board.FRAME * C.ZOOM_MAX;
  let projectionDirty = true;
  let placedYaw = NaN;

  const target = new THREE.Vector3(0, 0.7, 0);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);

  // ---- screen shake (P6) ----
  // Camera and look-at target move by the SAME offset, so the view translates
  // rather than swivelling. On an orthographic camera a swivel would shear the
  // elevation tiers, which is the one thing section 14 chose this projection to
  // avoid -- a shake that breaks the readability it is decorating is a bad
  // trade at any amplitude.
  let shakeAmount = 0;
  let frameLast = 0;
  let eveningLast = 0;
  // Where the camera is being asked to look, in world units. Null until the
  // first follow() call, so a renderer built before the world exists simply
  // keeps looking at the island.
  let followX = null, followY = 0, followZ = 0;
  let followSeeded = false;
  const placedTarget = new THREE.Vector3(NaN, NaN, NaN);
  const screenB = new THREE.Vector3();
  // TDD 14: the stage is a fixed 720x1280 and is scaled to fit the window, so
  // HUD maths is done in those units and never in real pixels.
  const STAGE_W = 720, STAGE_H = 1280;
  const shakeOffset = new THREE.Vector3();
  const basePosition = new THREE.Vector3();
  const shakeTarget = new THREE.Vector3();

  function placeCamera(now) {
    // One frame delta, shared by everything here that eases.
    const elapsed = frameLast ? Math.min((now - frameLast) / 1000, 0.1) : 0;
    frameLast = now;

    // ---- follow the king ----
    // The target is what the camera looks at, and it now moves. Easing is
    // exponential so it is frame-rate independent; the first call snaps, or the
    // camera would visibly glide in from the island centre at boot.
    if (C.FOLLOW && followX !== null) {
      const kXZ = followSeeded ? 1 - Math.exp(-elapsed / Math.max(1e-4, C.FOLLOW_LAG)) : 1;
      const kY = followSeeded ? 1 - Math.exp(-elapsed / Math.max(1e-4, C.FOLLOW_Y_LAG)) : 1;
      target.x += (followX - target.x) * kXZ;
      target.y += (followY - target.y) * kY;
      target.z += (followZ - target.z) * kXZ;
      followSeeded = true;
    }

    if (projectionDirty) {
      const hh = view.frustum / 2, hw = hh * (W() / H());
      camera.left = -hw; camera.right = hw; camera.top = hh; camera.bottom = -hh;
      // Bias the island up the frame, leaving the lower third for the HUD.
      camera.setViewOffset(W(), H(), 0, H() * C.VIEW_OFFSET_Y, W(), H());
      camera.updateProjectionMatrix();
      projectionDirty = false;
    }

    // The base position is still only recomputed when the yaw actually changes.
    // The shake is applied on top of it every frame, which is why the offset is
    // kept separately rather than added into the camera and left there -- adding
    // into a cached position accumulates, and the camera walks off the island.
    // The base position is cached, but the cache now has two inputs: the yaw
    // AND the target. Keying it on the yaw alone was what froze the camera when
    // shake was added, and a moving target would freeze it again.
    let baseMoved = false;
    if (view.yaw !== placedYaw || !placedTarget.equals(target)) {
      const d = C.DISTANCE;
      basePosition.set(
        target.x + Math.sin(view.yaw) * Math.cos(C.PITCH) * d,
        target.y + Math.sin(C.PITCH) * d,
        target.z + Math.cos(view.yaw) * Math.cos(C.PITCH) * d
      );
      placedYaw = view.yaw;
      placedTarget.copy(target);
      baseMoved = true;
    }

    // Two independent reasons the camera transform may need rewriting, and it
    // has to be rewritten if EITHER holds. An earlier version returned early
    // whenever no shake was active, which quietly froze the camera: the base
    // position was recomputed on a yaw change and then never applied, so
    // rotating the view did nothing at all unless something happened to be
    // shaking at that moment.
    let dirty = baseMoved;
    if (shakeAmount > 0.0005) {
      shakeAmount *= Math.pow(C.SHAKE_DECAY, elapsed * 60);
      shakeOffset.set(
        (Math.random() * 2 - 1) * shakeAmount,
        (Math.random() * 2 - 1) * shakeAmount * 0.6,
        (Math.random() * 2 - 1) * shakeAmount
      );
      dirty = true;
    } else if (shakeAmount !== 0) {
      shakeAmount = 0;
      shakeOffset.set(0, 0, 0);
      dirty = true;
    }
    if (!dirty) return;

    camera.position.copy(basePosition).add(shakeOffset);
    camera.lookAt(shakeTarget.copy(target).add(shakeOffset));
  }

  // Placed once at boot so a still camera has a valid transform before the
  // first shake ever happens.
  function seatCamera() {
    const d = C.DISTANCE;
    basePosition.set(
      target.x + Math.sin(view.yaw) * Math.cos(C.PITCH) * d,
      target.y + Math.sin(C.PITCH) * d,
      target.z + Math.cos(view.yaw) * Math.cos(C.PITCH) * d
    );
    placedYaw = view.yaw;
    camera.position.copy(basePosition);
    camera.lookAt(target);
  }
  seatCamera();

  function advanceRotateTween(now) {
    if (!rotateTween) return;
    const progress = Math.min(1, (now - rotateTween.start) / (C.TWEEN_SECONDS * 1000));
    view.yaw = rotateTween.from + (rotateTween.to - rotateTween.from) * Cubic.easeOut(progress);
    if (progress === 1) rotateTween = null;
  }

  // ---------------- ambient-dominant lighting, no shadow maps ----------------
  // Deliberately fill-heavy. A hard key would crash the vertical cliff faces to
  // grey; instead a soft warm key picks out facets, a cold rim keeps the faces
  // turned away from the sun blue rather than dead, and a large ambient floor
  // holds chalk reading as chalk.
  const sun = new THREE.DirectionalLight(0xfff2dc, 0.34);
  sun.position.set(-8, 7, 5);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xa8ccdf, 0.18);
  rim.position.set(7, 2.5, -6);
  scene.add(rim);
  const hemi = new THREE.HemisphereLight(0xeaf4f8, 0xd6cfc0, 0.45);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xfffdf8, 0.35);
  scene.add(ambient);

  // ---------------- evening ----------------
  // The daylight values above are the authored art; they are captured here
  // rather than duplicated in config, so retuning the diorama's lighting cannot
  // silently desynchronise the two ends of the blend.
  const E = config.evening;
  const DAY = {
    sun: { color: sun.color.clone(), intensity: sun.intensity },
    rim: { color: rim.color.clone(), intensity: rim.intensity },
    hemi: { sky: hemi.color.clone(), ground: hemi.groundColor.clone(), intensity: hemi.intensity },
    ambient: { color: ambient.color.clone(), intensity: ambient.intensity },
    sky: scene.background.clone(),
    haze: scene.fog.color.clone(),
    fogNear: scene.fog.near,
    fogFar: scene.fog.far,
    // Filled in by attachSky once the scene exists; the renderer is built first.
    top: null, bottom: null, pool: null
  };
  const NIGHT = {
    sun: { color: new THREE.Color(E.sun.color), intensity: E.sun.intensity },
    rim: { color: new THREE.Color(E.rim.color), intensity: E.rim.intensity },
    hemi: { sky: new THREE.Color(E.hemi.sky), ground: new THREE.Color(E.hemi.ground), intensity: E.hemi.intensity },
    ambient: { color: new THREE.Color(E.ambient.color), intensity: E.ambient.intensity },
    sky: new THREE.Color(E.sky),
    haze: new THREE.Color(E.haze),
    fogNear: E.fogNear,
    fogFar: E.fogFar,
    top: new THREE.Color(E.water.top),
    bottom: new THREE.Color(E.water.bottom),
    pool: new THREE.Color(E.water.pool)
  };

  // The sky gradient lives on the water plane, which is built after the
  // renderer. main.js hands it over as soon as the scene exists.
  let sky = null;
  function attachSky(material) {
    if (!material || !material.uniforms) return;
    sky = material.uniforms;
    DAY.top = sky.uTop.value.clone();
    DAY.bottom = sky.uBottom.value.clone();
    DAY.pool = sky.uPool.value.clone();
    applyEvening(Math.max(0, evening));
  }

  let eveningTarget = 0;
  let evening = -1;              // forced apply on the first frame
  const mix = (a, b, t) => a + (b - a) * t;

  function applyEvening(t) {
    sun.color.copy(DAY.sun.color).lerp(NIGHT.sun.color, t);
    sun.intensity = mix(DAY.sun.intensity, NIGHT.sun.intensity, t);
    rim.color.copy(DAY.rim.color).lerp(NIGHT.rim.color, t);
    rim.intensity = mix(DAY.rim.intensity, NIGHT.rim.intensity, t);
    hemi.color.copy(DAY.hemi.sky).lerp(NIGHT.hemi.sky, t);
    hemi.groundColor.copy(DAY.hemi.ground).lerp(NIGHT.hemi.ground, t);
    hemi.intensity = mix(DAY.hemi.intensity, NIGHT.hemi.intensity, t);
    ambient.color.copy(DAY.ambient.color).lerp(NIGHT.ambient.color, t);
    ambient.intensity = mix(DAY.ambient.intensity, NIGHT.ambient.intensity, t);
    scene.background.copy(DAY.sky).lerp(NIGHT.sky, t);
    scene.fog.color.copy(DAY.haze).lerp(NIGHT.haze, t);
    scene.fog.near = mix(DAY.fogNear, NIGHT.fogNear, t);
    scene.fog.far = mix(DAY.fogFar, NIGHT.fogFar, t);
    if (sky && DAY.top) {
      sky.uTop.value.copy(DAY.top).lerp(NIGHT.top, t);
      sky.uBottom.value.copy(DAY.bottom).lerp(NIGHT.bottom, t);
      sky.uPool.value.copy(DAY.pool).lerp(NIGHT.pool, t);
    }
    // The grade is deliberately NOT touched. Saturation, contrast and vignette
    // are the contrast balance, and the evening is a hue shift -- moving them
    // was what made the first version look hazy. It also means the dev overlay's
    // grade sliders stay under the player's control instead of being overwritten
    // every frame.
  }

  // ---------------- post ----------------
  const rtOptions = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  const canMultisample = !tier.weak && renderer.capabilities.isWebGL2 && THREE.WebGLMultisampleRenderTarget;
  const rt = canMultisample
    ? new THREE.WebGLMultisampleRenderTarget(1, 1, rtOptions)
    : new THREE.WebGLRenderTarget(1, 1, rtOptions);
  if (canMultisample) rt.samples = 4;

  const post = new THREE.Scene();
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = {
    tDiffuse: { value: rt.texture },
    uSat: { value: config.grade.saturation },
    uCon: { value: config.grade.contrast },
    uVig: { value: config.grade.vignette }
  };
  const gradeUniforms = {
    saturation: uniforms.uSat,
    contrast: uniforms.uCon,
    vignette: uniforms.uVig
  };
  post.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
    fragmentShader: [
      'varying vec2 vUv; uniform sampler2D tDiffuse; uniform float uSat, uCon, uVig;',
      'void main(){',
      ' vec3 c = texture2D(tDiffuse, vUv).rgb;',
      ' float d = distance(vUv, vec2(0.5,0.6)) * 1.4;',
      ' float v = uVig * smoothstep(0.36, 1.05, d);',
      // Corners lose colour first and brightness only a little, so the frame
      // closes in without ever turning muddy.
      ' float l = dot(c, vec3(0.299,0.587,0.114));',
      ' c = mix(vec3(l), c, uSat * (1.0 - v * 0.5));',
      ' c *= 1.0 - v * 0.07;',
      ' c = (c - 0.5) * uCon + 0.5;',
      // Gentle shoulder: whites roll off instead of clipping to paper flat.
      ' c -= max(vec3(0.0), c - 0.86) * 0.35;',
      // 8-bit dither, the only thing standing between a 1200px sky ramp and
      // visible banding.
      ' float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233))) * 43758.5453);',
      ' c += (n - 0.5) * 0.005;',
      ' gl_FragColor = vec4(clamp(c,0.0,1.0), 1.0);',
      '}'
    ].join('\n')
  })));

  // ---------------- resize ----------------
  const bufferSize = new THREE.Vector2();
  let lastW = 0, lastH = 0;
  function resize() {
    const w = W(), h = H();
    if (w === lastW && h === lastH) return;
    lastW = w; lastH = h;
    renderer.setSize(w, h, false);
    renderer.getDrawingBufferSize(bufferSize);
    rt.setSize(bufferSize.x, bufferSize.y);
    projectionDirty = true;
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  return {
    scene, camera, renderer, canvas, view, tier,

    // A level change builds a whole new renderer over the same host (see
    // main.js), so this one has to release everything it holds: the GL context,
    // the offscreen target, every geometry and material in the scene, and the
    // ResizeObserver -- which is the one thing here that would otherwise keep a
    // dead renderer alive and resizing forever.
    dispose() {
      observer.disconnect();
      const seen = new Set();
      scene.traverse(node => {
        if (node.geometry) node.geometry.dispose();
        for (const material of [].concat(node.material || [])) {
          if (!material || seen.has(material)) continue;
          seen.add(material);
          for (const value of Object.values(material)) {
            if (value && value.isTexture) value.dispose();
          }
          material.dispose();
        }
      });
      post.traverse(node => {
        if (node.geometry) node.geometry.dispose();
        if (node.material) node.material.dispose();
      });
      rt.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },

    rotate(delta) {
      rotateTween = null;
      view.yaw += delta;
    },
    tweenRotate(delta) {
      const now = performance.now();
      advanceRotateTween(now);
      const targetYaw = rotateTween ? rotateTween.to + delta : view.yaw + delta;
      rotateTween = { from: view.yaw, to: targetYaw, start: now };
    },
    zoom(delta) {
      view.frustum = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, view.frustum + delta));
      projectionDirty = true;
    },

    // Framing as a multiple of the board, BYPASSING the ZOOM_MIN/ZOOM_MAX clamp
    // that bounds what the player may do. The arrival cutscene opens far tighter
    // than play ever allows, which is the point of it.
    setZoom(multiple) {
      view.frustum = board.FRAME * multiple;
      projectionDirty = true;
    },

    // Called every frame with whether a wave is on the island. Easing lives
    // here rather than in the caller so a paused or stopped loop simply holds
    // the current light instead of snapping.
    setEvening(on) { eveningTarget = on ? 1 : 0; },
    attachSky,
    get evening() { return Math.max(0, evening); },

    // Where a point in tile space lands, in STAGE PIXELS -- the 720x1280
    // coordinate system the HUD is laid out in. The canvas fills the stage
    // exactly (#viewport is inset:0), so normalised device coordinates map
    // straight onto it, and the CSS transform that fits the stage to the window
    // carries the HUD along with the render for free.
    //
    // Used by the incoming-wave indicators, which have to sit on the screen edge
    // in the direction a boat is coming from and follow the camera as it orbits:
    // a compass rose that does not turn with the view is worse than none at all.
    screenPositionOf(tileX, tileZ, worldY) {
      screenB.set(board.px(tileX), worldY === undefined ? 0.6 : worldY, board.px(tileZ));
      screenB.project(camera);
      return {
        x: (screenB.x * 0.5 + 0.5) * STAGE_W,
        y: (1 - (screenB.y * 0.5 + 0.5)) * STAGE_H
      };
    },

    // One impulse, in world units. Takes the largest rather than summing, so a
    // catapult landing in a crowd shakes once and not six times over.
    shake(amount) {
      shakeAmount = Math.max(shakeAmount, amount);
    },

    // Called every frame with the king's interpolated position, in TILE space.
    // Taking tiles rather than world units keeps the conversion in one place --
    // board.px is the only thing that should know how big a tile is.
    follow(tileX, tileZ, worldY) {
      followX = board.px(tileX);
      followZ = board.px(tileZ);
      // FOLLOW_HEIGHT lifts him off his feet so he sits on the centre line
      // rather than below it -- which is a SCREEN-SPACE intent, so it is scaled
      // by how zoomed in the camera is. As a flat world offset it is 23px at the
      // default framing and 140px at the arrival cutscene's 6x, which would put
      // the king well below centre in the one shot that is entirely about him.
      const scale = view.frustum / (board.FRAME * C.FRUSTUM_START);
      followY = (worldY === undefined ? 0.7 : worldY) + C.FOLLOW_HEIGHT * scale;
    },
    // Where the camera is actually looking, for anything that needs to reason
    // about the centre of the view.
    get lookAt() { return target; },
    setGrade(key, value) {
      if (gradeUniforms[key]) gradeUniforms[key].value = value;
    },

    // Scene renders to an offscreen target; the grade then blits it to screen.
    draw() {
      resize();
      const now = performance.now();
      advanceRotateTween(now);

      if (evening !== eveningTarget) {
        const step = eveningLast ? Math.min((now - eveningLast) / 1000, 0.1) / E.seconds : 1;
        evening = evening < 0 ? eveningTarget
          : Math.abs(eveningTarget - evening) <= step ? eveningTarget
          : evening + Math.sign(eveningTarget - evening) * step;
        applyEvening(evening);
      }
      eveningLast = now;

      placeCamera(now);
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(post, postCam);
    }
  };
}
