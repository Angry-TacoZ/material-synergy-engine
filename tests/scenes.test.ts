import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, M } from '../src/simulation';

for (const scale of [1, 4]) test(`fir lower-right foliage remains in its crown at ${240 * scale}×${144 * scale}`, () => {
  const sim = new Simulation(240 * scale, 144 * scale);
  sim.load('fir');
  const foliage: number[] = [];
  for (let y = 121 * scale; y < 126 * scale; y++) {
    for (let x = 125 * scale; x < 146 * scale; x++) {
      const index = y * sim.width + x;
      if (sim.cells[index] === M.Grass) foliage.push(index);
    }
  }
  assert.ok(foliage.length > 0);
  for (let tick = 0; tick < 240; tick++) sim.step();
  assert.equal(foliage.filter(index => sim.cells[index] !== M.Grass).length, 0,
    'lower-right foliage must not fall out from under its bough');
});

test('fir preset builds a tapered wood-and-grass tree that remains grounded', () => {
  const sim = new Simulation();
  sim.load('fir');
  const at = (x: number, y: number) => sim.cells[y * sim.width + x];
  assert.equal(at(120, 20), M.Grass);
  assert.equal(at(120, 130), M.Wood);
  assert.equal(at(85, 118), M.Grass);
  assert.equal(at(85, 30), M.Empty);
  assert.ok(sim.counts().Grass > sim.counts().Wood);
  for (let i = 0; i < 120; i++) sim.step();
  const tree = sim.bodySummaries();
  assert.ok(tree.some(body => body.material === 'Wood' && body.maxY >= 132));
  assert.ok(tree.some(body => body.material === 'Grass' && body.minY < 35));
});
