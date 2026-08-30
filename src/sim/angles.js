// Hero TD -- angle helpers.
//
// Extracted so both the simulation and the renderer can use them without either
// importing the other. Facing and gait phase both wrap, and interpolating them
// naively makes a unit spin the long way round once per cycle -- a very visible
// glitch that reads as a physics bug rather than a maths one.

const TAU = Math.PI * 2;

export function lerpAngle(a, b, t) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}

export { TAU };
