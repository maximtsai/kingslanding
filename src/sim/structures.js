// Hero TD -- towers and houses.
//
// Both are one-tile, solid, damageable, and valid enemy targets, so they share a
// record. What separates them is who places them (TDD 4: houses are authored,
// towers are bought) and whether they shoot.
//
// TDD 7: towers block movement but do NOT block line of sight. They are solid to
// units and transparent to projectiles -- otherwise a dense cluster blinds itself
// and the player is punished for building what looks like a strong position.

import { config } from '../config.js';

export function createStructures(board, flow) {
  const N = board.N;
  const occupant = new Array(N * N).fill(null);
  // Tiles held by decorative geometry (the keep). Not buildable, not damageable.
  const reserved = new Set((board.level.reserved || []).map(([i, j]) => j * N + i));
  const list = [];
  let nextId = 1;

  const index = (i, j) => j * N + i;

  // A structure's footprint is a square of `span` tiles anchored at (i, j).
  // Everything downstream addresses it through its centre and half-extent, so a
  // 1x1 tower and a 2x2 castle need one code path rather than two.
  function add(record, span) {
    record.span = span || 1;      record.halfExtent = record.span / 2;
    // Centre of the footprint. For a 1x1 that is just the tile.
    record.x = record.i + (record.span - 1) / 2;
    record.z = record.j + (record.span - 1) / 2;
    record.isStructure = true;
    record.losId = 's' + record.id;
    list.push(record);
    for (const [ci, cj] of cells(record)) occupant[index(ci, cj)] = record;
    flow.invalidate();          // the passable set just changed
    return record;
  }

  // Every tile a structure sits on. The castle writes the same reference into
  // all four (TDD 4).
  function cells(record) {
    const out = [];
    for (let dj = 0; dj < record.span; dj++) {
      for (let di = 0; di < record.span; di++) out.push([record.i + di, record.j + dj]);
    }
    return out;
  }

  // Distance from a point to the structure's footprint edge, which is what every
  // attack range and aggro radius is measured against.
  function edgeDistance(x, z, record) {
    const inset = record.halfExtent - 0.5;   // 0 for 1x1, 0.5 for the castle
    const dx = Math.max(Math.abs(x - record.x) - inset, 0);
    const dz = Math.max(Math.abs(z - record.z) - inset, 0);
    return Math.hypot(dx, dz);
  }

  function house(i, j) {
    return add({
      id: nextId++, kind: 'house', type: 'house',
      i, j, hp: 120, maxHp: 120, alive: true,
      // TDD 7: carry rotation from the start even though nothing reads it yet.
      // Retrofitting it into placement, targeting arcs and the range overlay
      // later is far more work than carrying an unused field.
      rotation: 0
    });
  }

  function tower(type, i, j, maxHpOverride) {
    const spec = config.towers[type];
    // spec.hp is absent on the shared barricade capstones, which carry hpBonus
    // relative to whatever they were upgraded from. Restoring one from a
    // snapshot therefore supplies the already-resolved value.
    const maxHp = maxHpOverride !== undefined ? maxHpOverride
                : spec.hp !== undefined ? spec.hp
                : (spec.hpBonus || 100);
    return add({
      id: nextId++, kind: 'tower', type,
      i, j, hp: maxHp, maxHp, alive: true,
      rotation: 0,
      tier: spec.tier,
      line: spec.line,
      invested: spec.cost,      // total spent, for the 50% refund of TDD 7
      cooldown: 0,
      target: null,
      // Build timer is feel only: the build phase is untimed and READY snaps any
      // pending build to complete (TDD 7).
      building: spec.buildTime
    });
  }

  // TDD 7: an upgrade changes stats and silhouette, never footprint. So it is a
  // stat swap on a record that is already placed -- the tile, the id and every
  // reference an enemy or projectile holds to it all survive, which is why an
  // upgrade cannot strand a unit that was mid-approach.
  //
  // HP is carried as a fraction rather than reset: upgrading a tower that is
  // half dead should not heal it. The free repair between waves does that, and
  // doing it here would make upgrading mid-wave a heal, which TDD 7 forbids by
  // banning tower interaction during combat anyway.
  function upgrade(record, toType) {
    const spec = config.towers[toType];
    if (!spec) return false;
    const from = config.towers[record.type];
    if (!from.upgradesTo.includes(toType)) return false;

    const ratio = record.maxHp > 0 ? record.hp / record.maxHp : 1;
    // hpBonus entries (the shared barricade capstones) build on the parent
    // rather than replacing it, so a spiked Bulwark keeps the Bulwark's wall.
    const maxHp = spec.hp !== undefined ? spec.hp : record.maxHp + (spec.hpBonus || 0);

    record.type = toType;
    record.tier = spec.tier;
    record.line = spec.line;
    record.maxHp = maxHp;
    record.hp = Math.max(1, Math.round(maxHp * ratio));
    record.invested += spec.cost;
    record.building = spec.buildTime;
    record.target = null;
    // Cooldown is deliberately NOT reset: TDD 10's rule that changing targets
    // never refills a cooldown applies just as much to changing weapons.
    return true;
  }

  function free(record) {
    for (const [ci, cj] of cells(record)) {
      if (occupant[index(ci, cj)] === record) occupant[index(ci, cj)] = null;
    }
    // TDD 7: recompute flow fields on tower destruction -- its tile just opened.
    flow.invalidate();
  }

  // Destroyed, not gone. The record stays in the list so the free repair between
  // waves can stand it back up on its own tile at its own tier (TDD 2). Only a
  // deliberate takedown actually deletes a structure.
  function destroy(record) {
    if (!record.alive) return;
    record.alive = false;
    record.hp = 0;
    record.target = null;
    free(record);
  }

  // TDD 4: the castle is a permanent objective. Free, mandatory, placed once,
  // and never upgraded, moved, taken down or rebuilt.
  function castle(i, j) {
    const spec = config.castle;
    return add({
      id: nextId++, kind: 'castle', type: 'castle',
      i, j, hp: spec.hp, maxHp: spec.hp, alive: true,
      rotation: 0, tier: 1, invested: 0,
      cooldown: 0, target: null, building: 0
    }, spec.footprint);
  }

  // Placement predicates answer WHY, not just yes/no: the HUD turns the code
  // into a brief on-screen reason ("CAN'T PLACE ON CLIFF"). null means the spot
  // is legal. Codes are sim vocabulary; screen text belongs to the presentation.
  //
  // All four tiles must be land, empty, non-ramp, and on the SAME elevation --
  // a castle straddling a tier would have no coherent floor.
  //
  // The reachability clause is the one that matters: at least one non-castle land
  // tile has to touch the footprint, or the player has placed an objective the
  // raiders can never walk up to and the wave could never end.
  function castleReason(i, j) {
    const span = config.castle.footprint;
    const height = board.at(i, j);
    if (!height) return 'water';
    for (let dj = 0; dj < span; dj++) {
      for (let di = 0; di < span; di++) {
        const ci = i + di, cj = j + dj;
        if (!board.isLand(ci, cj)) return 'water';
        if (board.at(ci, cj) !== height) return 'cliff';   // no straddling tiers
        if (board.isRamp(ci, cj)) return 'stairs';
        if (reserved.has(cj * N + ci)) return 'obstruction';
        if (occupant[index(ci, cj)]) return 'occupied';
      }
    }
    // At least one reachable neighbour outside the footprint.
    const inside = (ci, cj) => ci >= i && ci < i + span && cj >= j && cj < j + span;
    for (let dj = -1; dj <= span; dj++) {
      for (let di = -1; di <= span; di++) {
        const ci = i + di, cj = j + dj;
        if (inside(ci, cj) || !board.isLand(ci, cj)) continue;
        if (occupant[index(ci, cj)]) continue;
        return null;
      }
    }
    return 'nopath';
  }

  function canPlaceCastle(i, j) { return castleReason(i, j) === null; }

  // TDD 7: a tower may only go where the tile is land and unoccupied. Never
  // ramps, water, or reserved decor.
  function placeReason(i, j) {
    if (!board.isLand(i, j)) return 'water';
    if (board.isRamp(i, j)) return 'stairs';
    if (reserved.has(j * N + i)) return 'obstruction';
    if (occupant[index(i, j)]) return 'occupied';
    return null;
  }

  // TDD 7: takedown refunds 50% of total invested, not of base cost. Build-phase
  // only; the UI for it is P4, but the rule belongs with the data.
  function sell(record) {
    const at = list.indexOf(record);
    if (at >= 0) list.splice(at, 1);
    free(record);
    return Math.floor(record.invested * 0.5);
  }

  return {
    list,
    at: (i, j) => (i < 0 || j < 0 || i >= N || j >= N) ? null : occupant[index(i, j)],
    house, tower, castle, upgrade, destroy, sell, cells, edgeDistance,
    canPlaceCastle, canPlaceCastleReason: castleReason,

    // TDD 7: placement only where the tile is land and unoccupied. Never ramps,
    // water, or shore.
    canPlace: (i, j) => placeReason(i, j) === null,
    canPlaceReason: placeReason,

    towers: () => list.filter(s => s.kind === 'tower' && s.alive),
    houses: () => list.filter(s => s.kind === 'house' && s.alive),
    alive: () => list.filter(s => s.alive),
    theCastle: () => list.find(s => s.kind === 'castle') || null,
    castleAlive: () => list.some(s => s.kind === 'castle' && s.alive),
    // Anything an enemy may target by proximity: towers, houses and the castle
    // (TDD 10). Barricades and bulwarks join this list in P4.
    targetable: () => list.filter(s => s.alive),

    // TDD 13: the wave is lost the INSTANT THE CASTLE FALLS, regardless of the
    // hero, tower or house state. Losing every tower and house is survivable so
    // long as the castle stands.
    castleFallen() {
      const keep = list.find(s => s.kind === 'castle');
      return !!keep && !keep.alive;
    },

    // Between waves everything comes back free, at full HP, at its full upgrade
    // tier (TDD 2). If an upgraded tower returned as a T1, upgrading would be a
    // trap and nobody would do it.
    repairAll() {
      for (const s of list) {
        s.hp = s.maxHp;
        // Only reclaim the tile if nothing has taken it in the meantime. Repair
        // runs at the top of the build phase, before the player can build, so
        // this should never fire -- but a structure silently overwriting another
        // one's tile would be a very hard bug to see.
        // The castle is never rebuilt (TDD 4). If it fell, the wave was lost and
        // the player is restarting, which rebuilds it from the snapshot instead.
        if (s.kind === 'castle') continue;
        if (!s.alive && cells(s).every(([ci, cj]) => !occupant[index(ci, cj)])) {
          s.alive = true;
          s.repaired = true;
          for (const [ci, cj] of cells(s)) occupant[index(ci, cj)] = s;
        }
        s.building = 0;
        s.target = null;
      }
      flow.invalidate();
    }
  };
}
