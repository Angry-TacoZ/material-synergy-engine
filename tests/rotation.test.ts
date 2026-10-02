import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, M } from '../src/simulation.ts';
const step = (s: Simulation, n: number) => { for (let i = 0; i < n; i++) s.step(); };
const block = (s: Simulation, x: number, y: number, w: number, h: number, t: number) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) s.set(xx, yy, t); };

test('an overhanging beam tips while a centred beam remains level', () => {
  const make = (x: number) => { const s = new Simulation(100, 80); block(s, 0, 79, 100, 1, M.Concrete); block(s, 40, 45, 6, 34, M.Concrete); block(s, x, 40, 30, 5, M.Wood); return s; };
  const unstable = make(40), stable = make(28), before = unstable.counts();
  step(unstable, 180); step(stable, 180);
  const u = unstable.bodySummaries().find(b => b.material === 'Wood')!, s = stable.bodySummaries().find(b => b.material === 'Wood')!;
  assert.ok(Math.abs(u.angle) > .2, JSON.stringify(u)); assert.equal(s.angle, 0);
  assert.deepEqual(unstable.counts(), before);
});

test('a tall buoyant ice piece tips without destroying displaced fluid', () => {
  const s = new Simulation(100, 100); block(s, 0, 99, 100, 1, M.Concrete); block(s, 0, 55, 100, 44, M.Water); block(s, 45, 20, 8, 60, M.Ice);
  const before = s.counts(); step(s, 500);
  const ice = s.bodySummaries(100).filter(b => b.material === 'Ice').sort((a, b) => b.cells - a.cells)[0];
  assert.ok(Math.abs(ice.angle) > .15, JSON.stringify(ice)); assert.deepEqual(s.counts(), before);
  assert.ok(ice.maxX - ice.minX > ice.maxY - ice.minY, 'the tall column settles into a flatter floating shape');
});

test('rotation preserves temperatures and texture coordinates of every solid cell', () => {
  const s = new Simulation(100, 80); block(s, 0, 79, 100, 1, M.Concrete); block(s, 40, 45, 6, 34, M.Concrete); block(s, 40, 40, 30, 5, M.Wood);
  const uv: number[] = []; for (let i = 0; i < s.cells.length; i++) if (s.cells[i] === M.Wood) { s.temperature[i] = 123; uv.push(s.surfaceUV[i]); }
  step(s, 180); const after: number[] = [];
  for (let i = 0; i < s.cells.length; i++) if (s.cells[i] === M.Wood) { after.push(s.surfaceUV[i]); assert.equal(s.temperature[i], 123); }
  assert.deepEqual(after.sort((a, b) => a - b), uv.sort((a, b) => a - b));
});
