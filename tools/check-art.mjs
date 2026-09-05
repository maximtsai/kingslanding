// Headless geometry smoke check: every building variant and every island.
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { createKit } from '../src/render/kit.js';
import { createStructurePrefabs } from '../src/render/structures.js';
import { flattenGroup } from '../src/render/flatten.js';
import { buildTerrain } from '../src/render/terrain.js';
import { createBoard } from '../src/sim/board.js';
import { LEVELS } from '../src/sim/levels.js';
import { config } from '../src/config.js';
import { palette } from '../src/render/palette.js';

function check(name, geometry, budget) {
  for (const key of ['position', 'normal', 'color']) {
    const attr = geometry.attributes[key];
    assert.ok(attr && attr.count === geometry.attributes.position.count, `${name}: ${key}`);
    assert.ok(attr.array.every(Number.isFinite), `${name}: non-finite ${key}`);
  }
  const triangles = (geometry.index?.count || geometry.attributes.position.count) / 3;
  assert.ok(triangles > 0 && triangles < budget, `${name}: triangle budget ${triangles}`);
  console.log(`${name}: ${triangles} triangles`);
}
const board = createBoard(LEVELS.one, config.board);
const prefabs = createStructurePrefabs({THREE, P:palette, board, kit:createKit(THREE), rand:()=>0.5});
for (const [name, prefab] of [
  ['castle', prefabs.castle()], ['house', prefabs.house(0,0,0,1)],
  ...Object.keys(config.towers).map(type=>[type,prefabs.towerOfType(type)])
]) check(name, flattenGroup(THREE,prefab).geometry, 12000);
for (const [name, level] of Object.entries(LEVELS)) {
  const scene = new THREE.Scene();
  buildTerrain({THREE,P:palette,scene,board:createBoard(level,config.board)});
  const meshes = scene.children.filter(node=>node.isMesh);
  assert.equal(meshes.length,1, 'Terrain must remain a single mesh');
  check(`terrain ${name}`,meshes[0].geometry,100000);
}
