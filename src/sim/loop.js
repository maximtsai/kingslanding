// Hero TD -- fixed timestep with interpolated rendering.
//
// TDD section 17. The simulation advances in fixed increments regardless of frame
// rate; rendering interpolates between the last two states by the leftover alpha.
// Everything the renderer draws therefore has to keep a previous transform as
// well as a current one -- see world.js.
//
// The spiral guard matters more than it looks. A backgrounded tab or a stalled
// GPU hands back an enormous delta; without a cap the sim tries to catch up,
// takes longer than real time to do it, and falls further behind on every frame.
// Dropping time is the correct failure: the simulation stays deterministic and
// the game merely skips, rather than locking the tab.

export function createLoop({ hz, maxCatchup, step, render }) {
  const dt = 1 / hz;
  let accumulator = 0;
  let last = 0;
  let frameId = 0;
  let running = false;

  // Rolling frame-time average, for the dev overlay.
  let fps = 0;

  function frame(now) {
    if (!running) return;
    frameId = requestAnimationFrame(frame);

    const elapsed = Math.min((now - last) / 1000, 1);   // hard clamp on tab restore
    last = now;
    if (elapsed > 0) fps += ((1 / elapsed) - fps) * 0.1;

    accumulator += elapsed;

    let steps = 0;
    while (accumulator >= dt) {
      if (steps >= maxCatchup) { accumulator = 0; break; }   // surrender, drop the debt
      step(dt);
      accumulator -= dt;
      steps++;
    }

    render(accumulator / dt, elapsed);
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      accumulator = 0;
      frameId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(frameId);
    },
    get fps() { return fps; },
    get running() { return running; }
  };
}
