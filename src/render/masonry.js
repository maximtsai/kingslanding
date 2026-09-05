// Small, baked architectural details. No textures, runtime updates or extra
// instance draws: these meshes are consumed by the existing prefab flattener.
export function createMasonry(THREE) {
  function courses(mesh, width, depth, height, color, course = 0.19) {
    // The original solid shell becomes the recessed mortar behind the panels.
    const baseColors = mesh.geometry.attributes.color;
    if (baseColors) {
      for (let i = 0; i < baseColors.array.length; i++) baseColors.array[i] *= 0.91;
      baseColors.needsUpdate = true;
    }
    const positions = [], colors = [];
    const tint = new THREE.Color(color);
    const rows = Math.max(1, Math.round(height / course));
    function face(span, plane, side) {
      const columns = Math.max(1, Math.ceil(span / 0.25));
      const step = span / columns;
      for (let row = 0; row < rows; row++) {
        const stagger = row % 2 ? step / 2 : 0;
        for (let col = -1; col < columns; col++) {
          const left = Math.max(-span / 2 + 0.023, -span / 2 + col * step + stagger + 0.005);
          const right = Math.min(span / 2 - 0.023, -span / 2 + (col + 1) * step + stagger - 0.005);
          if (right <= left) continue;
          const bottom = row * height / rows + 0.004;
          const top = (row + 1) * height / rows - 0.004;
          const point = (u, y) => side === 0 ? [u, y, plane] : side === 1 ? [plane, y, -u]
            : side === 2 ? [-u, y, plane] : [plane, y, u];
          const verts = [point(left, bottom), point(right, bottom), point(right, top), point(left, top)];
          const variation = 0.92 + ((row * 7 + col * 13 + side * 3 + 31) % 11) * 0.008;
          for (const i of [0, 1, 2, 0, 2, 3]) {
            positions.push(...verts[i]);
            const ao = 0.77 + 0.23 * Math.min(1, verts[i][1] / height * 3);
            colors.push(tint.r * variation * ao, tint.g * variation * ao, tint.b * variation * ao);
          }
        }
      }
    }
    face(width, depth / 2 + 0.001, 0); face(depth, width / 2 + 0.001, 1);
    face(width, -depth / 2 - 0.001, 2); face(depth, -width / 2 - 0.001, 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    mesh.add(new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({vertexColors: true})));
    return mesh;
  }

  function roof(width, depth, height, color) {
    const positions = [], colors = [];
    const tint = new THREE.Color(color);
    const corners = [[-width/2,0,depth/2],[width/2,0,depth/2],[width/2,0,-depth/2],[-width/2,0,-depth/2]];
    let tile = 0;
    function triangle(a, b, c, level) {
      if (level) {
        const mid = (p, q) => p.map((v, i) => (v + q[i]) / 2);
        const ab = mid(a,b), bc = mid(b,c), ca = mid(c,a);
        triangle(a,ab,ca,level-1); triangle(ab,b,bc,level-1);
        triangle(ca,bc,c,level-1); triangle(ab,bc,ca,level-1); return;
      }
      const shade = 0.91 + ((tile++ * 7) % 9) * 0.012;
      for (const p of [a,b,c]) { positions.push(...p); colors.push(tint.r*shade,tint.g*shade,tint.b*shade); }
    }
    for (let i=0;i<4;i++) triangle(corners[i],corners[(i+1)%4],[0,height,0],2);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry,new THREE.MeshLambertMaterial({vertexColors:true}));
  }
  return { courses, roof };
}
