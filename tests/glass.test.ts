import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, materials, M } from '../src/simulation.ts';
const block = (s: Simulation, x: number, y: number, w: number, h: number, t: number) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) s.set(xx, yy, t); };
const step = (s: Simulation, n: number) => { for (let i = 0; i < n; i++) s.step(); };
const mass = (s: Simulation) => [...s.cells].reduce((sum, t) => sum + materials[t].density, 0);

test('glass shatters after a long fall onto concrete while preserving mass', () => {
  const s = new Simulation(50, 50); block(s, 0, 49, 50, 1, M.Concrete); block(s, 20, 5, 5, 5, M.Glass);
  const before = mass(s); step(s, 80);
  assert.equal(s.counts().Glass, undefined); assert.equal(s.counts()['Glass shards'], 25); assert.equal(s.reactions.shattering, 25); assert.equal(mass(s), before);
});

test('gentle glass landings remain intact', () => {
  const s = new Simulation(50, 50); block(s, 0, 49, 50, 1, M.Concrete); block(s, 20, 42, 5, 5, M.Glass);
  step(s, 80); assert.equal(s.counts().Glass, 25); assert.equal(s.reactions.shattering, 0);
});

test('a hard glass-on-glass impact shatters both pieces before they bond', () => {
  const s = new Simulation(50, 50); block(s, 0, 49, 50, 1, M.Concrete); block(s, 15, 45, 20, 4, M.Glass); block(s, 20, 5, 5, 5, M.Glass);
  const before = mass(s); step(s, 80);
  assert.equal(s.counts().Glass, undefined); assert.equal(s.counts()['Glass shards'], 105); assert.equal(mass(s), before);
});

test('soft wood cushions a glass fall in this model', () => {
  const s = new Simulation(50, 50); block(s, 0, 49, 50, 1, M.Concrete); block(s, 15, 45, 20, 4, M.Wood); block(s, 20, 5, 5, 5, M.Glass);
  step(s, 80); assert.equal(s.counts().Glass, 25); assert.equal(s.reactions.shattering, 0);
});
