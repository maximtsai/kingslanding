// Hero TD -- the arrival cutscene.
//
// The king comes ashore on his own boat before the first build phase. It is a
// LEVEL PROPERTY, not a game one: a level with an `intro` block opens on this,
// and a level without one opens on castle siting exactly as before. Only level
// one has it -- you arrive at the realm once.
//
// Almost nothing here is new machinery. The boat is an ordinary record pushed
// into the same list waves.js fills, so the boat view draws it without knowing
// this exists. The leap ashore is the cliff jump, which already has an
// anticipate / airborne / landing animation and a pose to go with it. What this
// file actually owns is the ORDER of those things and the moment control passes
// to the player.
//
// The king rides the boat by having his position written each step rather than
// by being a passenger: passengers are enemies, drawn from the enemy rigs, and
// he is drawn by the hero view. Riding him this way also means the camera --
// which follows him already -- needs no cutscene mode at all.

import { config } from '../config.js';

export function createIntro(world, board, heroControl) {
  const C = config.intro;
  const hero = heroControl.hero;

  let boat = null;
  let state = 'idle';           // idle -> sailing -> grounded -> leaping -> retreating -> done
  let stateTime = 0;
  let total = 0;                // whole-cutscene clock, for the camera pull-back

  const available = () => !!board.level.intro;

  function begin() {
    const spec = board.level.intro;
    if (!spec) { state = 'done'; return; }

    const [sx, sz] = spec.from;
    const [li, lj] = spec.land;
    // Where the hull grounds: short of the landing tile along the approach, the
    // same proportion waves.js uses for its authored fallback.
    const stop = { x: li + (sx - li) * C.stopOffset, z: lj + (sz - lj) * C.stopOffset };
    const distance = Math.hypot(stop.x - sx, stop.z - sz) || 1;

    boat = {
      id: 'intro',
      x: sx, z: sz, y: 0,
      px: sx, pz: sz, py: 0,
      facing: Math.atan2(stop.x - sx, stop.z - sz),
      stop, land: [li, lj],
      speed: distance / C.sailSeconds,
      landed: false,
      introPhase: 'approach',
      // Marked unloaded from the outset. A boat that never unloads holds a wave
      // open forever (waves.complete), and this one is never part of a wave.
      unloaded: true,
      passengers: [],
      alive: true
    };
    world.waves.boats.push(boat);

    hero.alive = true;
    hero.goal = null; hero.field = null; hero.waypoint = null;
    hero.cliffJump = null; hero.jumpPhase = null;
    ride();
    // Keep interpolation endpoints synchronized with the cutscene pose. The
    // render loop blends px/pz/py into x/z/y, so stale endpoints can make the
    // king briefly snap backward while the boat is moving.
    hero.px = hero.x; hero.pz = hero.z; hero.py = hero.y;
    hero.pFacing = hero.facing;


    state = 'sailing';
    stateTime = 0;
    total = 0;
  }

  function ride() {
    hero.x = boat.x;
    hero.z = boat.z;
    hero.y = C.deckHeight;
    hero.facing = boat.facing;
    hero.moving = false;
  }

  function step(dt, combat) {
    if (state === 'done' || state === 'idle') return;
    total += dt;
    stateTime += dt;

    if (state === 'sailing') {
      boat.px = boat.x; boat.pz = boat.z; boat.py = boat.y;
      hero.px = hero.x; hero.pz = hero.z; hero.py = hero.y;

      const dx = boat.stop.x - boat.x, dz = boat.stop.z - boat.z;
      const remaining = Math.hypot(dx, dz);
      const move = boat.speed * dt;
      if (remaining <= move) {
        boat.x = boat.stop.x; boat.z = boat.stop.z;
        boat.landed = true;
      } else {
        boat.x += (dx / remaining) * move;
        boat.z += (dz / remaining) * move;
      }
      ride();
      // The hero is a passenger during the intro; normal movement is suspended,
      // so keep both simulation and presentation facing fixed to the boat.
      hero.pFacing = hero.facing;

      if (boat.landed) {
        boat.introPhase = 'grounded';
        state = 'grounded';
        stateTime = 0;
      }
      return;
    }

    if (state === 'grounded') {
      // Let the hull settle visibly into the shore before the king disembarks.
      ride();
      if (stateTime >= C.boatGroundSeconds) {
        heroControl.leapTo(boat.land[0], boat.land[1], C.deckHeight);
        state = 'leaping';
        stateTime = 0;
      }
      return;
    }

    // Both remaining states just let the hero controller animate. It returns
    // early from everything else while a cliff jump is in progress, and there is
    // nothing on the island to shoot at yet.
    heroControl.step(dt, combat);

    if (state === 'leaping') {
      if (!hero.cliffJump) {
        state = 'settling';
        stateTime = 0;
        boat.introPhase = 'retreating';
      }
      return;
    }
    if (state === 'settling' && stateTime >= C.settleSeconds) state = 'done';
  }

  return {
    begin, step, available,
    get done() { return state === 'done'; },
    get state() { return state; },
    // Drives the camera pull-back in main.js.
    get elapsed() { return total; },
    get boat() { return boat; }
  };
}
