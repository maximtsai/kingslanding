// Hero TD -- gesture disambiguation.
//
// TDD section 14 calls this the highest-risk input design in the project, and it
// is: drag-to-rotate and tap-to-move share the same finger.
//
//   touchstart        -> record position and time, state = PENDING
//   touchmove         -> if distance > DRAG_THRESHOLD: state = ROTATING
//   touchend
//     state PENDING   -> issue a tap (regardless of elapsed time)
//     state ROTATING  -> no tap
//   two touches       -> state = PINCHING, cancel any pending tap
//
// The threshold is distance, never time, so a slow deliberate tap still issues a
// move order. Once a gesture becomes a rotation it can never resolve back into a
// tap, and a second finger cancels a pending tap outright.
//
// P2 owns the other half of this: testing it on real hardware and tuning the
// threshold. The TDD is blunt about the stakes -- this either feels invisible or
// feels broken, with very little in between -- and that is not something a
// desktop mouse can tell us.

import { config } from '../config.js';

const PENDING = 'PENDING', ROTATING = 'ROTATING', PINCHING = 'PINCHING';

export function attachGestures(canvas, view, onTap) {
  const G = config.gestures;
  const C = config.camera;
  const active = new Map();          // pointerId -> { startX, startY, lastX, lastY, time }
  let state = null;
  let pinchDistance = 0;

  const points = () => [...active.values()];
  const spread = () => {
    const [a, b] = points();
    if (!a || !b) return 0;
    return Math.hypot(a.lastX - b.lastX, a.lastY - b.lastY) || 1;
  };

  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    active.set(e.pointerId, {
      startX: e.clientX, startY: e.clientY,
      lastX: e.clientX, lastY: e.clientY, time: performance.now()
    });
    if (active.size >= 2) {
      // A second finger cancels a pending tap outright.
      state = PINCHING;
      pinchDistance = spread();
    } else {
      state = PENDING;
    }
  });

  canvas.addEventListener('pointermove', e => {
    const point = active.get(e.pointerId);
    if (!point) return;

    if (state === PINCHING && active.size >= 2) {
      point.lastX = e.clientX; point.lastY = e.clientY;
      // True 2D separation. Measuring only the horizontal gap made a vertical
      // pinch do nothing at all and a diagonal one under-report badly -- and a
      // vertical pinch is the natural one on a 720x1280 portrait frame.
      const now = spread();
      view.zoom((pinchDistance - now) * 0.02);
      pinchDistance = now;
      return;
    }

    const travelled = Math.hypot(e.clientX - point.startX, e.clientY - point.startY);
    if (state === PENDING && travelled > G.DRAG_THRESHOLD) state = ROTATING;
    if (state === ROTATING) {
      view.rotate(-(e.clientX - point.lastX) * C.DRAG_SPEED);
    }
    point.lastX = e.clientX; point.lastY = e.clientY;
  });

  function end(e) {
    const point = active.get(e.pointerId);
    active.delete(e.pointerId);
    if (!point) return;

    if (state === PENDING && active.size === 0) {
      // Elapsed time is deliberately not a rejection condition; the cap exists
      // only to drop a finger that has been resting on the glass.
      if (performance.now() - point.time < G.TAP_MAX_MS) {
        onTap(point.startX, point.startY);
      }
    }
    if (active.size === 0) state = null;
    else if (active.size === 1) state = ROTATING;   // a pinch never becomes a tap
  }

  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    view.zoom(e.deltaY * C.WHEEL_SPEED);
  }, { passive: false });
}
