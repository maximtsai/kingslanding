// Hero TD -- boats and wave spawning.
//
// TDD section 11. Boats spawn on open water beyond the island, every one of them
// steers toward the exact centre of the map, and roughly ten seconds later they
// ground and unload. Because the heading is fixed, the landing point is simply
// where that ray first meets land -- which is what makes the approach solvable
// at spawn time rather than something to steer around during it.
//
// The ten seconds are the point. They turn the telegraph from dead time into a
// decision: boats and passengers are shootable the whole way in, so shore towers
// start earning before the wave lands and the hero's position is a fresh choice
// every wave instead of park-and-forget.

import { config } from '../config.js';
import { landingTable, SECTORS, SECTOR_HALF, wrapAngle } from './landing.js';

const PASSENGER_SPACING = 0.17;

export function createWaves(world) {
  const board = world.board;
  const W = config.waves;
  const boats = [];
  let nextId = 1;
  let pending = [];          // boats not yet spawned, with their delays
  let elapsed = 0;
  let active = false;

  // Every landing this board admits, resolved once. The board does not change
  // during a level, so neither does this.
  const table = landingTable(board, W.spawnRadius);

  // Landings already taken THIS wave: angle for the approach, point for the
  // beach. Reset by start(), not derived from the live boat list -- a boat that
  // has already unloaded still owns the spot it used.
  let claimed = [];

  // The next wave, resolved AHEAD OF TIME so the build phase can show where it
  // will come ashore.
  //
  // This is the whole point of resolving landings early rather than at spawn:
  // a player who cannot see where a wave will land is guessing about tower
  // placement, and finds out ten seconds after committing. Rolling it at the
  // start of the build phase and then honouring exactly that roll turns the
  // guess into a read. `start()` consumes this rather than re-picking, so what
  // was shown is what arrives -- if it re-rolled, the preview would be a lie.
  let previewed = null;

  const mid = (board.N - 1) / 2;

  // TDD 11's rejection loop, run as a filter over the enumerated landings rather
  // than as guess-and-retry. Every option in the table already ends at a real
  // beach, so a boat can never choose a stretch of coastal cliff -- that is not
  // a rejection it has to survive, it is simply not on the menu.
  //
  // A boat definition may name the shore it comes from (`from: 'N'`). That is
  // what levels 2 and 3 escalate through -- two landings on opposite shores at
  // the same instant, which is the natural difficulty curve for a single-hero
  // game because you cannot be in two places (TDD 11). Without it the compass
  // is up to Math.random, and "simultaneous opposite landings" is something that
  // happens to a wave rather than something a wave is.
  //
  // The constraints are relaxed in order rather than all-or-nothing, because
  // they are not equally important. Landing somewhere already taken is the worst
  // outcome and is given up last; the authored sector is a preference and is
  // given up first. A landing in slightly the wrong place beats a wave that does
  // not spawn.
  function pickLanding(from) {
    const centre = from === undefined ? null : SECTORS[from];
    if (from !== undefined && centre === undefined) {
      throw new Error(`boat "from" must be a compass point, got ${JSON.stringify(from)}`);
    }

    // Minimum spawn arc keeps two boats from overlapping on the way in; minimum
    // landing separation keeps them off the same patch of beach. TDD 11: two
    // boats MAY share a tile, since tiles are large. They may not share a point.
    const arcFree = o => claimed.every(c => Math.abs(wrapAngle(o.angle - c.angle)) >= W.minSpawnArc);
    const spotFree = o => claimed.every(c =>
      Math.hypot(o.stop.x - c.x, o.stop.z - c.z) >= W.minLandingSeparation);
    const inSector = o => centre === null ||
      Math.abs(wrapAngle(o.angle - centre)) <= SECTOR_HALF;

    const passes = [
      o => inSector(o) && arcFree(o) && spotFree(o),
      o => arcFree(o) && spotFree(o),          // any shore, but still its own spot
      o => spotFree(o),                        // crowd the approach before the beach
      () => true                               // last resort: any real beach
    ];

    for (const pass of passes) {
      const pool = table.options.filter(pass);
      if (!pool.length) continue;
      const chosen = pool[(Math.random() * pool.length) | 0];
      claimed.push({ angle: chosen.angle, x: chosen.stop.x, z: chosen.stop.z });
      return chosen;
    }

    // Only reachable on a board with no landable coast at all, which
    // board.validate() refuses to load. Kept because TDD 11 requires that a wave
    // can never fail to spawn, and "cannot happen" is not the same as "does not
    // need a branch".
    const shore = board.level.shoreFallback;
    const [fi, fj] = shore[(Math.random() * shore.length) | 0];
    const angle = Math.atan2(fi - mid, fj - mid);
    const sx = mid + Math.sin(angle) * W.spawnRadius;
    const sz = mid + Math.cos(angle) * W.spawnRadius;
    const span = Math.hypot(mid - sx, mid - sz) || 1;
    const stop = { x: fi + (sx - fi) * 0.22, z: fj + (sz - fj) * 0.22 };
    claimed.push({ angle, x: stop.x, z: stop.z });
    return { sx, sz, ux: (mid - sx) / span, uz: (mid - sz) / span, land: [fi, fj], stop };
  }

  function spawnBoat(definition) {
    const landing = definition.landing || pickLanding(definition.from);
    const distance = Math.hypot(landing.stop.x - landing.sx, landing.stop.z - landing.sz);
    const boat = {
      id: nextId++,
      x: landing.sx, z: landing.sz, y: 0,
      px: landing.sx, pz: landing.sz, py: 0,
      facing: Math.atan2(landing.ux, landing.uz),
      stop: landing.stop,
      land: landing.land,
      speed: distance / W.approachSeconds,
      landed: false,
      unloaded: false,
      passengers: [],
      alive: true
    };

    // Passengers exist from the moment the boat does, so they are shootable
    // during the approach (TDD 11). They ride at boat-relative offsets and take
    // damage individually -- the boat has no HP pool of its own, which avoids an
    // all-or-nothing swing when a shore tower connects.
    definition.units.forEach((type, index) => {
      // spawnEnemy returns null at the concurrency cap of TDD 10. A wave that
      // hits it loses passengers rather than the game losing a frame.
      const u = world.spawnEnemy(type, boat.x, boat.z);
      if (!u) return;
      u.state = 'boat';
      u.boat = boat;
      u.boatOffset = (index - (definition.units.length - 1) / 2) * PASSENGER_SPACING;
      boat.passengers.push(u);
    });

    boats.push(boat);
    return boat;
  }

  function step(dt) {
    if (!active) return;
    elapsed += dt;

    for (let k = pending.length - 1; k >= 0; k--) {
      if (pending[k].delay <= elapsed) {
        spawnBoat(pending[k]);
        pending.splice(k, 1);
      }
    }

    for (const boat of boats) {
      boat.px = boat.x; boat.pz = boat.z; boat.py = boat.y;
      if (!boat.landed) {
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
      }

      // Passengers ride until the hull grounds, then step onto the landing tile.
      for (const u of boat.passengers) {
        if (!u.alive || u.state !== 'boat') continue;
        if (boat.landed) {
          const [li, lj] = boat.land;
          u.x = li + (Math.random() - 0.5) * 0.5;
          u.z = lj + (Math.random() - 0.5) * 0.5;
          u.px = u.x; u.pz = u.z;
          u.tier = board.at(li, lj);
          u.onRamp = false;
          u.y = board.topY(li, lj) - config.board.SINK;
          u.py = u.y;
          u.state = 'walking';
          u.boat = null;
          world.retarget(u);
        } else {
          // Bow-to-stern formation. Boat facing is local +z, so its forward
          // vector in tile space is (sin(yaw), cos(yaw)).
          u.x = boat.x + Math.sin(boat.facing) * u.boatOffset;
          u.z = boat.z + Math.cos(boat.facing) * u.boatOffset;
          u.y = 0.16;
          u.facing = boat.facing;
        }
      }
      if (boat.landed && !boat.unloaded) {
        world.events.push({ type: 'boatLanded', x: boat.x, z: boat.z });
      }
      if (boat.landed) boat.unloaded = true;
    }
  }

  return {
    boats,
    get active() { return active; },
    get pending() { return pending.length; },

    // Takes the wave itself rather than an index: which table an index means
     // depends on the level, and that is the world's business, not the boat
     // spawner's.
    // Resolve where every boat of a wave will come ashore, without spawning
    // anything. Safe to call repeatedly: it re-rolls from scratch each time, so
    // a restart gets a fresh wave rather than the one the player already saw.
    preview(definition) {
      claimed = [];
      previewed = definition.boats.map(b => ({
        delay: b.delay,
        from: b.from,
        units: b.units.slice(),
        landing: pickLanding(b.from)
      }));
      return previewed.map(b => ({
        delay: b.delay,
        from: b.from,
        // Where the boat appears, in tile space -- the direction it comes from.
        spawn: { x: b.landing.sx, z: b.landing.sz },
        land: b.landing.land.slice(),
        // What is aboard, grouped: the indicators want counts per type, not a
        // list of twelve identical grunts.
        counts: b.units.reduce((m, t) => (m[t] = (m[t] || 0) + 1, m), {}),
        total: b.units.length
      }));
    },

    start(definition) {
      // Honour the preview if it is for this wave; otherwise resolve now.
      const rolled = previewed && previewed.length === definition.boats.length
        ? previewed
        : definition.boats.map(b => ({ delay: b.delay, from: b.from, units: b.units.slice(), landing: null }));
      pending = rolled.map(b => ({ delay: b.delay, from: b.from, units: b.units.slice(), landing: b.landing }));
      previewed = null;
      boats.length = 0;
      elapsed = 0;
      active = true;
    },

    // Corpse records remain through their sink animation, so the final death is
    // allowed to finish before the game enters the next build phase.
    complete() {
      return active && pending.length === 0 &&
        boats.every(b => b.unloaded) &&
        world.units.length === 0;
    },

    stop() { active = false; boats.length = 0; pending = []; claimed = []; previewed = null; },

    // For tests and the dev overlay: what this board actually offers.
    get landings() { return table; },
    step
  };
}
