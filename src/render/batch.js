// Island diorama -- static batching.
//
// Nothing in the diorama moves, so the scene graph is collapsed once at boot:
//   * opaque prop meshes bake their material colour into vertex colours and
//     merge into a single buffer (hundreds of calls -> one),
//   * textured ground sprites merge per material,
//   * outline lines merge per material.
// Every vertex keeps its original baked normal, so the result is pixel-identical
// to drawing the props one at a time.
//
// Destructive by design: the meshes it consumes are removed from the graph, so
// nothing may hold a reference to an individual prop after it runs.


export function batchStatic(THREE, root) {
  root.updateMatrixWorld(true);
  const solid = { position: [], normal: [], color: [] };
  const sprites = new Map(), lines = new Map();
  const victims = [];
  const normalMatrix = new THREE.Matrix3();
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  const bucket = (map, material, keys) => {
    if (!map.has(material)) map.set(material, keys.reduce((o, k) => (o[k] = [], o), {}));
    return map.get(material);
  };

  root.traverse(obj => {
    if (obj.isMesh) {
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      const attributes = obj.geometry.attributes;
      if (!attributes.position) return;
      const opaque = attributes.normal && materials.every(m =>
        m && m.isMeshLambertMaterial && m.side === THREE.FrontSide && !m.transparent);
      const sprite = attributes.uv && materials.length === 1 &&
        materials[0].isMeshBasicMaterial && materials[0].map;
      if (!opaque && !sprite) return;

      const index = obj.geometry.index;
      const total = index ? index.count : attributes.position.count;
      const groups = obj.geometry.groups.length
        ? obj.geometry.groups
        : [{ start: 0, count: total, materialIndex: 0 }];
      normalMatrix.getNormalMatrix(obj.matrixWorld);
      groups.forEach(group => {
        // Primitive geometries carry one group per face, with material indices
        // past the end of a single-material array; fall back to the lone one.
        const material = materials[group.materialIndex] || materials[0];
        const target = opaque ? solid : bucket(sprites, material, ['position', 'uv']);
        const tinted = opaque && material.vertexColors && attributes.color;
        const end = Math.min(group.start + group.count, total);
        for (let k = group.start; k < end; k++) {
          const vi = index ? index.getX(k) : k;
          v.fromBufferAttribute(attributes.position, vi).applyMatrix4(obj.matrixWorld);
          target.position.push(v.x, v.y, v.z);
          if (opaque) {
            n.fromBufferAttribute(attributes.normal, vi).applyMatrix3(normalMatrix).normalize();
            target.normal.push(n.x, n.y, n.z);
            if (tinted) target.color.push(attributes.color.getX(vi), attributes.color.getY(vi), attributes.color.getZ(vi));
            else target.color.push(material.color.r, material.color.g, material.color.b);
          } else {
            target.uv.push(attributes.uv.getX(vi), attributes.uv.getY(vi));
          }
        }
      });
      victims.push(obj);
      return;
    }

    const isLine = obj.isLineSegments || obj.isLineLoop;
    if (!isLine || !obj.material || !obj.material.isLineBasicMaterial) return;
    const attribute = obj.geometry.attributes.position;
    if (!attribute) return;
    const target = bucket(lines, obj.material, ['position']);
    const emit = i => {
      v.fromBufferAttribute(attribute, i).applyMatrix4(obj.matrixWorld);
      target.position.push(v.x, v.y, v.z);
    };
    if (obj.isLineLoop) {
      for (let i = 0; i < attribute.count; i++) { emit(i); emit((i + 1) % attribute.count); }
    } else {
      for (let i = 0; i < attribute.count; i++) emit(i);
    }
    victims.push(obj);
  });

  // Deepest first, hoisting any surviving children (outlines live under the
  // meshes they trace) into the parent with their transform baked in.
  victims.reverse().forEach(obj => {
    const parent = obj.parent;
    if (!parent) return;
    while (obj.children.length) {
      const child = obj.children[0];
      obj.remove(child);
      child.applyMatrix4(obj.matrix);
      parent.add(child);
    }
    parent.remove(obj);
  });

  const attach = (mesh) => { mesh.frustumCulled = false; root.add(mesh); };
  const geometryFrom = data => {
    const geometry = new THREE.BufferGeometry();
    Object.keys(data).forEach(name => {
      if (data[name].length) {
        geometry.setAttribute(name, new THREE.Float32BufferAttribute(data[name], name === 'uv' ? 2 : 3));
      }
    });
    return geometry;
  };
  if (solid.position.length) {
    attach(new THREE.Mesh(geometryFrom(solid), new THREE.MeshLambertMaterial({ vertexColors: true })));
  }
  sprites.forEach((data, material) => attach(new THREE.Mesh(geometryFrom(data), material)));
  lines.forEach((data, material) => {
    const mesh = new THREE.LineSegments(geometryFrom(data), material);
    mesh.renderOrder = 2;
    attach(mesh);
  });
}
