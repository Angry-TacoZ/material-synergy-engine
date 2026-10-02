import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MaterialRenderer } from '../src/rendering.ts';
import { Simulation, M } from '../src/simulation.ts';

const image = (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }) as ImageData;

test('material rendering leaves simulation state and random sequence untouched', () => {
  const s = new Simulation(96, 96), reference = new Simulation(96, 96);
  s.load('landscape'); reference.load('landscape');
  const pixels = image(96, 96), renderer = new MaterialRenderer(96, 96);
  renderer.render(pixels, s); renderer.render(pixels, s);
  assert.deepEqual(s.cells, reference.cells); assert.deepEqual(s.life, reference.life);
  assert.deepEqual(s.surfaceUV, reference.surfaceUV);
  assert.equal(s.ticks, 0); assert.equal(s.random(), reference.random());
  assert.ok(pixels.data.some(v => v > 0));
});

test('surface texture coordinates travel with a falling connected piece', () => {
  const s = new Simulation(96, 96);
  s.set(40, 30, M.Wood); s.set(41, 30, M.Wood); s.set(40, 31, M.Wood);
  const coordinates = [s.surfaceUV[30 * 96 + 40], s.surfaceUV[30 * 96 + 41], s.surfaceUV[31 * 96 + 40]];
  for (let i = 0; i < 6; i++) s.step();
  assert.deepEqual([s.surfaceUV[31 * 96 + 40], s.surfaceUV[31 * 96 + 41], s.surfaceUV[32 * 96 + 40]], coordinates);
});

test('lava changes lighting on nearby stone without moving or recoloring its material ID', () => {
  const s = new Simulation(96, 96), renderer = new MaterialRenderer(96, 96), pixels = image(96, 96);
  for (let y = 40; y < 75; y++) for (let x = 40; x < 75; x++) s.set(x, y, M.Stone);
  renderer.render(pixels, s);
  const index = (55 * 96 + 55) * 4, unlit = pixels.data[index];
  for (let y = 35; y < 50; y++) for (let x = 22; x < 37; x++) s.set(x, y, M.Lava);
  renderer.render(pixels, s);
  assert.ok(pixels.data[index] > unlit, 'nearby molten material warms the stone surface');
  assert.equal(s.cells[55 * 96 + 55], M.Stone);
});
