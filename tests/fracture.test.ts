import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, materials, M } from '../src/simulation.ts';

const make = (neck: number) => {
  const s = new Simulation(80, 80);
  for (let x = 0; x < 80; x++) s.set(x, 79, M.Glass);
  for (let y = 35; y < 40; y++) for (let x = 10; x < 60; x++) s.set(x, y, M.Concrete);
  for (let y = 40; y < 79; y++) for (let x = 35; x < 35 + neck; x++) s.set(x, y, M.Concrete);
  return s;
};
const step = (s: Simulation, n: number) => { for (let i = 0; i < n; i++) s.step(); };
const mass = (s: Simulation) => [...s.cells].reduce((sum, t) => sum + materials[t].density, 0);

test('a narrow concrete support fractures under concentrated weight', () => {
  const s = make(1), before = mass(s), count = Object.values(s.counts()).reduce((a, b) => a + b, 0);
  step(s, 120);
  assert.ok(s.reactions.fracture > 0); assert.ok(s.counts().Rubble > 0);
  assert.equal(mass(s), before); assert.equal(Object.values(s.counts()).reduce((a, b) => a + b, 0), count);
  assert.ok(s.bodySummaries(100).some(b => b.material === 'Concrete' && b.minY > 35 && b.cells >= 200), 'the released beam falls independently of the broken support');
});

test('a wide concrete column safely carries the same beam', () => {
  const s = make(12), before = s.counts(); step(s, 120);
  assert.equal(s.reactions.fracture, 0); assert.deepEqual(s.counts(), before);
});

test('a centred concrete footing remains intact under distributed support', () => {
  const s = new Simulation(80, 80);
  for (let y = 65; y < 80; y++) for (let x = 10; x < 70; x++) s.set(x, y, M.Concrete);
  step(s, 120); assert.equal(s.reactions.fracture, 0); assert.equal(s.counts().Concrete, 900);
});
