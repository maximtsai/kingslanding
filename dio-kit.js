// Island diorama -- the modelling toolkit.
//
// The small vocabulary every prop is built from: cached materials and box
// geometries, a bevelled box, baked base occlusion, a strut spanning two points,
// and the soft contact sprites that sit under things.
//
// Materials and box geometries are cached by value, which is what lets the
// static batcher later collapse the whole island into one draw call.
(function () {
  const D = window.Diorama || (window.Diorama = {});

  D.createKit = function (THREE) {
    const materialCache = new Map();
    const mat = color => {
      if (!materialCache.has(color)) {
        materialCache.set(color, new THREE.MeshLambertMaterial({ color, flatShading: true }));
      }
      return materialCache.get(color);
    };

    const boxGeometries = new Map();
    // Sits on the origin and runs up +y, so props stack by setting position.y.
    function boxGeometry(w, d, hgt) {
      const key = w + ':' + d + ':' + hgt;
      if (!boxGeometries.has(key)) {
        const geometry = new THREE.BoxGeometry(w, hgt, d);
        geometry.translate(0, hgt / 2, 0);
        boxGeometries.set(key, geometry);
      }
      return boxGeometries.get(key);
    }

    // b = 0 returns a cached shared geometry -- never call baseAO on one of those,
    // since baseAO writes vertex colours into the geometry itself.
    function bevelBox(w, d, hgt, b, color) {
      if (!b) return new THREE.Mesh(boxGeometry(w, d, hgt), mat(color));
      const s = new THREE.Shape();
      s.moveTo(-w / 2 + b, 0);
      s.lineTo(w / 2 - b, 0); s.lineTo(w / 2, b);
      s.lineTo(w / 2, hgt - b); s.lineTo(w / 2 - b, hgt);
      s.lineTo(-w / 2 + b, hgt); s.lineTo(-w / 2, hgt - b);
      s.lineTo(-w / 2, b); s.lineTo(-w / 2 + b, 0);
      const g = new THREE.ExtrudeGeometry(s, {
        depth: d - b * 2, bevelEnabled: true, bevelThickness: b,
        bevelSize: b, bevelSegments: 1
      });
      g.translate(0, 0, -d / 2 + b);
      return new THREE.Mesh(g, mat(color));
    }

    // Darkens a mesh toward its own base, so it looks bedded into the ground
    // without any shadow pass. Mutates the geometry, so only use it on the
    // bevelled (freshly built) variant of bevelBox.
    function baseAO(mesh, low) {
      const g = mesh.geometry;
      g.computeBoundingBox();
      const p = g.attributes.position;
      const c = mesh.material.color;
      const min = g.boundingBox.min.y, height = g.boundingBox.max.y - min || 1;
      const colors = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const rise = Math.min(1, (p.getY(i) - min) / height * 4);
        const shade = low + (1 - low) * rise;
        const offset = i * 3;
        colors[offset] = c.r * shade;
        colors[offset + 1] = c.g * shade;
        colors[offset + 2] = c.b * shade;
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      mesh.material = mesh.material.clone();
      mesh.material.vertexColors = true;
    }

    // A box spanning two points, for timber bracing and bowstrings. lookAt runs in
    // world space, so it has to be called while the mesh is still parentless --
    // hence returning the mesh for the caller to add rather than adding it here.
    function strut(a, b, thickness, color) {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const mesh = new THREE.Mesh(boxGeometry(thickness, thickness, length), mat(color));
      mesh.position.set(a[0], a[1], a[2]);
      mesh.lookAt(b[0], b[1], b[2]);   // local +z now points down the span
      mesh.rotateX(Math.PI / 2);       // swing the geometry's +y shaft onto it
      return mesh;
    }

    return { mat, boxGeometry, bevelBox, baseAO, strut };
  };

  // Contact occlusion, not cast shadows: a cool grey-green pool that only ever
  // sits directly beneath a prop, so nothing throws a directional silhouette.
  D.createSoftSprites = function (THREE, scene) {
    function radialTex(stops) {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d').createRadialGradient(64, 64, 0, 64, 64, 64);
      stops.forEach(s => g.addColorStop(s[0], s[1]));
      const ctx = c.getContext('2d');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(c);
      t.minFilter = THREE.LinearFilter;
      return t;
    }
    const blobTex = radialTex([[0, 'rgba(65,81,67,0.53)'], [0.55, 'rgba(65,81,67,0.2)'], [1, 'rgba(65,81,67,0)']]);
    const warmTex = radialTex([[0, 'rgba(242,193,78,0)'], [0.55, 'rgba(242,193,78,0.45)'], [0.82, 'rgba(242,193,78,0.31)'], [1, 'rgba(242,193,78,0)']]);
    const boatFoamTex = radialTex([[0, 'rgba(255,255,255,0)'], [0.5, 'rgba(255,255,255,0.83)'], [1, 'rgba(255,255,255,0)']]);

    const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.3, fog: false });
    const warmMat = new THREE.MeshBasicMaterial({ map: warmTex, transparent: true, depthWrite: false, fog: false });
    const boatFoamMat = new THREE.MeshBasicMaterial({ map: boatFoamTex, transparent: true, depthWrite: false, opacity: 0.73, fog: false });

    const quadGeo = new THREE.PlaneGeometry(1, 1);
    const group = new THREE.Group();
    scene.add(group);

    function blob(x, y, z, size, material) {
      const m = new THREE.Mesh(quadGeo, material || blobMat);
      m.scale.setScalar(size);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y + 0.012, z);
      group.add(m);
      return m;
    }

    return { group, blob, blobMat, warmMat, boatFoamMat };
  };
})();
