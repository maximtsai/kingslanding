// Hero TD -- scene assembly.
//
// Builds the island once and splits it across the two roots described in TDD 17.
//
//   staticRoot   terrain, water, nature, decoration -- batched at load, then frozen
//   dynamicRoot  units, and later towers, hero, boats, projectiles -- never batched
//
// The split is the whole point of this file. The batcher's own header warns that
// nothing may hold a reference to an individual prop after it runs; it collapses
// hundreds of meshes into one buffer and drops the objects. That is exactly right
// for trees and exactly fatal for anything that moves, upgrades or dies.
//
// The test for which root a thing belongs in is not "does it move" but "can it
// ever change". A tower stands still and is still dynamic, because it upgrades.

import { createKit, createSoftSprites } from './kit.js';
import { createRigFactory } from './rigs.js';
import { buildTerrain } from './terrain.js';
import { buildWater } from './water.js';
import { buildStructures } from './structures.js';
import { buildNature } from './nature.js';
import { buildDecor } from './decor.js';
import { createKingRig } from './king.js';
import { batchStatic } from './batch.js';
import { palette } from './palette.js';
import { rng } from './util.js';
import { config } from '../config.js';

export function buildScene(THREE, scene, board, seed) {
  const staticRoot = new THREE.Group();
  const dynamicRoot = new THREE.Group();
  scene.add(staticRoot, dynamicRoot);

  const kit = createKit(THREE);
  const soft = createSoftSprites(THREE, staticRoot);
  const rigs = createRigFactory(THREE, kit, palette);

  // Builders that emit merge-able props write into ctx.props; terrain and water
  // add to ctx.scene directly, because they are already single meshes or carry
  // custom shaders the batcher would not understand.
  const props = new THREE.Group();
  staticRoot.add(props);

  const ctx = {
    THREE,
    P: palette,
    scene: staticRoot,
    board,
    rand: rng(seed),
    SINK: config.board.SINK,
    kit, soft, rigs, props, dynamicRoot,
    used: new Set(),
    K: (i, j) => i + ':' + j
  };

  // Order is load-bearing twice over: structures claim tiles before nature
  // scatters onto them, and every builder draws from one shared PRNG, so moving
  // a stage reshuffles every random decision downstream of it.
  const terrain = buildTerrain(ctx);
  ctx.footprints = terrain.footprints;
  const water = buildWater(ctx);
  ctx.fadeMaterial = water.fadeMaterial;
  // buildStructures now places only the scenery -- the keep and the stairways --
  // and hands back the prefab builders that the dynamic views construct houses
  // and towers from on demand.
  const prefabs = buildStructures(ctx);
  buildNature(ctx);
  buildDecor(ctx);

  // Freeze the scenery. Nothing added after this point may be batched.
  batchStatic(THREE, props);
  batchStatic(THREE, soft.group);

  // The king is a gameplay object, so he is built after the freeze and lives in
  // the dynamic root with everything else that moves.
  const kingRig = createKingRig(THREE, kit, palette);

  return {
    staticRoot, dynamicRoot, kit, soft, rigs, prefabs, kingRig,
    // The gradient that stands in for the sky. See water.js.
    skyMaterial: water.skyMaterial,
    // Tall props that are not gameplay objects but still hide people behind
    // them, so section 15's occlusion rule has to reach them too.
    scenery: prefabs.scenery || [],
    gridMesh: terrain.gridMesh
  };
}
