import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, M } from '../src/simulation';

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
