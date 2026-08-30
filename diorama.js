// Island diorama -- entry point.
//
// Registers the <island-diorama> custom element and assembles the scene from the
// dio-*.js parts. Owns everything that is not scene content: renderer, camera,
// lights, the post-processing grade, input and the render loop.
//
// LOADING CONTRACT
// The design-canvas runtime fetches exactly this one file and evaluates it with
// `new Function`, stubbing `require` -- so there is no module system available
// here. The other parts are plain <script> tags in the host page and register
// themselves on window.Diorama. Dynamically inserted scripts are async, so their
// order is not guaranteed: no part may read another at load time, and boot waits
// until every one it needs has arrived.
(function () {
  const PARTS = [
    'palette', 'createBoard', 'rng', 'gpuTier', 'createKit', 'createSoftSprites',
    'buildTerrain', 'buildWater', 'buildStructures', 'buildNature',
    'buildActors', 'buildKing', 'batchStatic'
  ];
  const ready = () => window.THREE && window.Diorama && PARTS.every(k => window.Diorama[k]);

  const SEED = 4471;
  const SINK = 0.02;              // how far props settle into the grass

  class Diorama extends HTMLElement {
    connectedCallback() {
      if (this._started) return;
      this._started = true;
      this.style.cssText = 'display:block;position:absolute;left:0;top:0;width:100%;height:100%';
      const wait = () => ready() ? this.boot(window.THREE, window.Diorama) : setTimeout(wait, 60);
      wait();
    }
    static get observedAttributes() { return ['saturation', 'contrast', 'vignette', 'grid']; }
    attributeChangedCallback() { this.sync && this.sync(); }
    num(n, d) { const v = parseFloat(this.getAttribute(n)); return isFinite(v) ? v : d; }

    boot(THREE, D) {
      const el = this;
      const W = () => el.clientWidth || 720, H = () => el.clientHeight || 1280;
      const P = D.palette;
      const rand = D.rng(SEED);
      const board = D.createBoard();
      const FRAME = board.FRAME;

      const tier = D.gpuTier();
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
      renderer.shadowMap.enabled = false;
      renderer.outputEncoding = THREE.sRGBEncoding;
      const canvas = renderer.domElement;
      canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';
      el.appendChild(canvas);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(P.skyTop);
      // Whisper of aerial perspective: the far side of the island settles into the haze.
      scene.fog = new THREE.Fog(P.haze, 44, 118);

      // ---------------- camera ----------------
      // Orthographic and fixed-pitch. The frustum is expressed in board widths, so
      // a bigger map frames itself without retuning.
      const PITCH = 35 * Math.PI / 180;
      let yaw = 0.62, frustum = FRAME * 2.05;
      const Cubic = { easeOut: t => 1 - Math.pow(1 - t, 3) };
      let rotateTween = null;
      const ZOOM_MIN = FRAME * 1.5, ZOOM_MAX = FRAME * 3.25;
      let projectionDirty = true;
      const target = new THREE.Vector3(0, 0.7, 0);
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
      function placeCam() {
        if (projectionDirty) {
          const hh = frustum / 2, hw = hh * (W() / H());
          cam.left = -hw; cam.right = hw; cam.top = hh; cam.bottom = -hh;
          // Bias the island up the frame, leaving the lower third for the HUD.
          cam.setViewOffset(W(), H(), 0, H() * 0.11, W(), H());
          cam.updateProjectionMatrix();
          projectionDirty = false;
        }
        const d = 50;
        cam.position.set(
          target.x + Math.sin(yaw) * Math.cos(PITCH) * d,
          target.y + Math.sin(PITCH) * d,
          target.z + Math.cos(yaw) * Math.cos(PITCH) * d
        );
        cam.lookAt(target);
      }
      function advanceRotateTween(now) {
        if (!rotateTween) return;
        const progress = Math.min(1, (now - rotateTween.start) / 700);
        yaw = rotateTween.from + (rotateTween.to - rotateTween.from) * Cubic.easeOut(progress);
        if (progress === 1) rotateTween = null;
      }

      // ---------------- ambient-dominant lighting, no shadow maps ----------------
      // Deliberately fill-heavy. A hard key would crash the vertical cliff faces to
      // grey; instead a soft warm key picks out facets, a cold rim keeps the faces
      // turned away from the sun blue rather than dead, and a large ambient floor
      // holds chalk reading as chalk. Roughly 0.75 side to 1.08 top.
      const sun = new THREE.DirectionalLight(0xfff2dc, 0.34);
      sun.position.set(-8, 7, 5);
      scene.add(sun);
      const rim = new THREE.DirectionalLight(0xa8ccdf, 0.18);
      rim.position.set(7, 2.5, -6);
      scene.add(rim);
      scene.add(new THREE.HemisphereLight(0xeaf4f8, 0xd6cfc0, 0.45));
      scene.add(new THREE.AmbientLight(0xfffdf8, 0.35));

      // ---------------- scene assembly ----------------
      // Order matters twice over: structures claim tiles before nature scatters
      // onto them, and every builder draws from one shared PRNG, so moving a stage
      // reshuffles every random decision downstream of it.
      const ctx = {
        THREE, P, scene, rand, board, SINK,
        kit: D.createKit(THREE),
        soft: D.createSoftSprites(THREE, scene),
        props: new THREE.Group(),
        used: new Set(),
        K: (i, j) => i + ':' + j
      };
      scene.add(ctx.props);

      const terrain = D.buildTerrain(ctx);
      ctx.footprints = terrain.footprints;
      ctx.fadeMaterial = D.buildWater(ctx).fadeMaterial;
      D.buildStructures(ctx);
      D.buildNature(ctx);
      D.buildActors(ctx);
      D.buildKing(ctx);
      D.batchStatic(THREE, ctx.props);
      D.batchStatic(THREE, ctx.soft.group);
      const gridMesh = terrain.gridMesh;

      // ---------------- post ----------------
      const renderTargetOptions = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
      const canMultisample = !tier.weak && renderer.capabilities.isWebGL2 && THREE.WebGLMultisampleRenderTarget;
      const rt = canMultisample
        ? new THREE.WebGLMultisampleRenderTarget(1, 1, renderTargetOptions)
        : new THREE.WebGLRenderTarget(1, 1, renderTargetOptions);
      if (canMultisample) rt.samples = 4;
      const post = new THREE.Scene();
      const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const uni = {
        tDiffuse: { value: rt.texture },
        uSat: { value: this.num('saturation', 1.02) },
        uCon: { value: this.num('contrast', 1.05) },
        uVig: { value: this.num('vignette', 0.46) }
      };
      post.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
        uniforms: uni,
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
          // 8-bit dither. Cheap, and the only thing standing between a 1200px sky
          // ramp and visible banding.
          ' float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233))) * 43758.5453);',
          ' c += (n - 0.5) * 0.005;',
          ' gl_FragColor = vec4(clamp(c,0.0,1.0), 1.0);',
          '}'
        ].join('\n')
      })));
      this.sync = () => {
        uni.uSat.value = this.num('saturation', 1.02);
        uni.uCon.value = this.num('contrast', 1.05);
        uni.uVig.value = this.num('vignette', 0.46);
        gridMesh.visible = this.getAttribute('grid') === 'true';
      };
      this.sync();

      // ---------------- input ----------------
      let drag = null;
      canvas.addEventListener('pointerdown', e => { drag = e.clientX; canvas.setPointerCapture(e.pointerId); });
      canvas.addEventListener('pointerup', () => drag = null);
      canvas.addEventListener('pointermove', e => { if (drag !== null) { yaw -= (e.clientX - drag) * 0.008; drag = e.clientX; } });
      canvas.addEventListener('wheel', e => {
        e.preventDefault();
        frustum = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, frustum + e.deltaY * 0.012));
        projectionDirty = true;
      }, { passive: false });
      this.rotate = d => {
        const now = performance.now();
        advanceRotateTween(now);
        const targetYaw = rotateTween ? rotateTween.to + d : yaw + d;
        rotateTween = { from: yaw, to: targetYaw, start: now };
      };
      this.zoom = d => { frustum = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, frustum + d)); projectionDirty = true; };

      const bufSize = new THREE.Vector2();
      let lastW = 0, lastH = 0;
      function resize() {
        const w = W(), hh = H();
        if (w === lastW && hh === lastH) return;
        lastW = w; lastH = hh;
        renderer.setSize(w, hh, false);
        renderer.getDrawingBufferSize(bufSize);
        rt.setSize(bufSize.x, bufSize.y);
        projectionDirty = true;
      }
      new ResizeObserver(resize).observe(el);
      resize();

      // Scene renders to an offscreen target, then the grade blits it to screen.
      (function loop() {
        requestAnimationFrame(loop);
        resize();
        advanceRotateTween(performance.now());
        placeCam();
        renderer.setRenderTarget(rt);
        renderer.render(scene, cam);
        renderer.setRenderTarget(null);
        renderer.render(post, postCam);
      })();
    }
  }
  if (!customElements.get('island-diorama')) customElements.define('island-diorama', Diorama);
})();
