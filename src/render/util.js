// Island diorama -- pure helpers.
//
// Deterministic randomness, planar geometry, and the GPU capability probe.
// Nothing here touches three.js or the DOM scene graph, so it stays trivially
// testable and reusable.


// Seeded PRNG. The whole scene is generated from one stream, so the same seed
// always lays out the same island -- and inserting a call anywhere shifts
// everything after it.
export function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Position-keyed hash: the same tile always gets the same jitter, independent
// of the order anything was built in.
export function hash01(x, z) {
  let n = Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(z | 0, 0x5f356495) ^ 4471;
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];

// Positive for counter-clockwise rings, which is how outer contours are told
// apart from the holes punched through them.
export const signedArea = points => points.reduce((sum, p, i) => {
  const q = points[(i + 1) % points.length];
  return sum + p[0] * q[1] - q[0] * p[1];
}, 0) / 2;

export function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
        point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// Mitred offset of a closed ring. The clamp stops a sharp corner from throwing
// its miter out to infinity.
export function offsetLoop(points, distance) {
  return points.map((p, i) => {
    const previous = points[(i + points.length - 1) % points.length], next = points[(i + 1) % points.length];
    const edgeA = [p[0] - previous[0], p[1] - previous[1]], edgeB = [next[0] - p[0], next[1] - p[1]];
    const lenA = Math.hypot(...edgeA) || 1, lenB = Math.hypot(...edgeB) || 1;
    const nA = [edgeA[1] / lenA, -edgeA[0] / lenA], nB = [edgeB[1] / lenB, -edgeB[0] / lenB];
    const mx = nA[0] + nB[0], mz = nA[1] + nB[1], ml = Math.hypot(mx, mz) || 1;
    const miter = [mx / ml, mz / ml];
    const scale = Math.max(-Math.abs(distance) * 1.5, Math.min(Math.abs(distance) * 1.5,
      distance / Math.max(0.2, miter[0] * nB[0] + miter[1] * nB[1])));
    return [p[0] + miter[0] * scale, p[1] + miter[1] * scale];
  });
}

let cachedGpuTier = null;
export function gpuTier() {
  if (cachedGpuTier) return cachedGpuTier;
  const tier = { mobile: false, weak: false };
  let gpu = '', hasWebGL2 = false;
  try {
    const canvas = document.createElement('canvas');
    const gl2 = canvas.getContext('webgl2');
    hasWebGL2 = !!gl2;
    const gl = gl2 || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      const extension = gl.getExtension('WEBGL_debug_renderer_info');
      if (extension) gpu = (gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) || '').toLowerCase();
    }
  } catch (error) { /* Best-effort capability probe. */ }
  const ua = (navigator.userAgent || '').toLowerCase();
  if (/adreno|mali|powervr|videocore|tegra|vivante/.test(gpu)) tier.mobile = true;
  if (/apple\s*(?:gpu|a\d|m\d)/.test(gpu) && navigator.maxTouchPoints > 1) tier.mobile = true;
  if (/android|iphone|ipod|ipad|mobile/.test(ua)) tier.mobile = true;
  if (tier.mobile) {
    const ancientGpu = /mali-?(?:400|450|t\d{3})|adreno(?: \(tm\))? [2-4]\d\d/.test(gpu);
    const starved = navigator.deviceMemory && navigator.deviceMemory <= 2 &&
      navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
    tier.weak = ancientGpu || !hasWebGL2 || !!starved;
  }
  cachedGpuTier = tier;
  return tier;
}
