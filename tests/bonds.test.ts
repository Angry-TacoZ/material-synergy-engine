import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, M } from '../src/simulation.ts';

test('fracture and rotation leave no disconnected islands in cached concrete bodies', () => {
  const s = new Simulation(240, 144); s.load('stress');
  for (let i = 0; i < 600; i++) s.step();
  const seen = new Set<number>();
  for (let i = 0; i < s.cells.length; i++) {
    if (s.cells[i] !== M.Concrete || seen.has(i)) continue;
    const cells = [i]; seen.add(i);
    for (let q = 0; q < cells.length; q++) {
      const cell = cells[q];
      for (const n of [cell % s.width ? cell - 1 : -1, cell % s.width + 1 < s.width ? cell + 1 : -1, cell - s.width, cell + s.width]) {
        if (n >= 0 && n < s.cells.length && s.cells[n] === M.Concrete && !seen.has(n)) { seen.add(n); cells.push(n); }
      }
    }
    assert.equal(s.bodyAt(i % s.width, Math.floor(i / s.width))!.cells, cells.length, 'each physical fragment must be its own moving body');
  }
  assert.ok(s.bodySummaries(1000).filter(b => b.material === 'Concrete').every(b => b.minY > 100), 'released fragments descend toward the floor');
});
