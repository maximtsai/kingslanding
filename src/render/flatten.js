// Hero TD -- flattening a rigid prefab into one instanceable geometry.
//
// A tower is fourteen little boxes that never move relative to one another. Drawn
// as a Group that is fourteen draw calls every time one is built; ten towers cost
// a hundred and forty. But because nothing inside it articulates, the whole thing
// can be baked down to a single geometry with its material colours written into
// vertex colours -- and then every tower of that type is one instanced draw.
//
// This is the same trick `batch.js` plays on the static island, applied per
// prefab rather than per scene, so the result stays a thing the game can place,
// rotate and destroy at runtime.
//
// Only valid for prefabs whose parts are rigid with respect to each other. Units
// articulate, so they are instanced per body part instead (see units.js).

export function flattenGroup(THREE, group) {
  group.updateMatrixWorld(true);

  const positions = [], normals = [], colors = [];
  const vertex = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();

  group.traverse(node => {
    if (!node.isMesh) return;
    const geometry = node.geometry;
    const attributes = geometry.attributes;
    if (!attributes.position || !attributes.normal) return;

    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const index = geometry.index;
    const total = index ? index.count : attributes.position.count;
    const groups = geometry.groups.length
      ? geometry.groups
      : [{ start: 0, count: total, materialIndex: 0 }];

    normalMatrix.getNormalMatrix(node.matrixWorld);

    for (const part of groups) {
      // Primitive geometries carry one group per face with material indices past
      // the end of a single-material array; fall back to the lone one.
      const material = materials[part.materialIndex] || materials[0];
      if (!material || !material.color) continue;
      // baseAO writes shading into the geometry's own vertex colours; honour
      // those where they exist so the bedded-in look survives the bake.
      const tinted = material.vertexColors && attributes.color;
      const end = Math.min(part.start + part.count, total);

      for (let k = part.start; k < end; k++) {
        const vi = index ? index.getX(k) : k;
        vertex.fromBufferAttribute(attributes.position, vi).applyMatrix4(node.matrixWorld);
        positions.push(vertex.x, vertex.y, vertex.z);
        normal.fromBufferAttribute(attributes.normal, vi).applyMatrix3(normalMatrix).normalize();
        normals.push(normal.x, normal.y, normal.z);
        if (tinted) {
          colors.push(
            attributes.color.getX(vi),
            attributes.color.getY(vi),
            attributes.color.getZ(vi)
          );
        } else {
          colors.push(material.color.r, material.color.g, material.color.b);
        }
      }
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  // The box, not just the sphere: TDD 15's occlusion test needs the prefab's
  // actual silhouette, and a sphere around a tall thin tower is mostly air.
  geometry.computeBoundingBox();

  return {
    geometry,
    material: new THREE.MeshLambertMaterial({ vertexColors: true })
  };
}
