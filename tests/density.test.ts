import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, materials, M } from '../src/simulation.ts';

const step = (s: Simulation, count: number) => { for (let i = 0; i < count; i++) s.step(); };
const block = (s: Simulation, x: number, y: number, w: number, h: number, type: number) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) s.set(xx, yy, type); };
const pool = (type: number) => { const s = new Simulation(80, 80); block(s, 0, 79, 80, 1, type === M.Stone ? M.Glass : M.Stone); block(s, 0, 30, 80, 49, M.Water); block(s, 30, 42, 10, 10, type); return s; };
const body = (s: Simulation, name: string) => s.bodySummaries(100).find(b => b.material === name)!;
const totalMass = (s: Simulation) => [...s.cells].reduce((sum, type) => sum + materials[type].density / 1000, 0);

test('all materials have a valid density and body mass scales with volume', () => {
  assert.ok(materials.every(m => Number.isFinite(m.density) && m.density >= 0));
  const s = new Simulation(20, 20); block(s, 5, 5, 4, 2, M.Wood);
  assert.equal(s.bodyAt(5, 5)!.mass, 8 * .65);
  block(s, 9, 5, 4, 2, M.Wood); assert.equal(s.bodyAt(5, 5)!.mass, 16 * .65);
  s.set(8, 5, M.Empty); s.set(8, 6, M.Empty);
  assert.equal(s.bodySummaries().length, 2);
  assert.ok(Math.abs(s.bodySummaries().reduce((sum, b) => sum + b.mass, 0) - 14 * .65) < 1e-9);
});

test('ice and wood rise from underwater and float partially submerged', () => {
  for (const type of [M.Ice, M.Wood]) {
    const s = pool(type), before = s.counts(), mass = totalMass(s);
    step(s, 1200);
    const b = body(s, materials[type].name);
    assert.ok(b.minY < 30 && b.maxY >= 30, `${b.material} should cross the water surface: ${JSON.stringify(b)}`);
    assert.ok(b.maxY < 60);
    assert.deepEqual(s.counts(), before); assert.ok(Math.abs(totalMass(s) - mass) < 1e-6);
  }
});

test('stone and glass sink in water and remain intact', () => {
  for (const type of [M.Stone, M.Glass]) {
    const s = pool(type); step(s, 500);
    const b = body(s, materials[type].name);
    assert.equal(b.maxY, 78); assert.equal(b.cells, 100);
  }
});

test('heavier liquids settle below lighter liquids without losing mass', () => {
  const s = new Simulation(12, 18);
  block(s, 0, 14, 12, 4, M.Oil); block(s, 0, 10, 12, 4, M.Water); block(s, 0, 6, 12, 4, M.Saltwater);
  const before = s.counts(), mass = totalMass(s); step(s, 100);
  for (let x = 0; x < 12; x++) { assert.equal(s.cells[17 * 12 + x], M.Saltwater); assert.equal(s.cells[10 * 12 + x], M.Water); assert.equal(s.cells[6 * 12 + x], M.Oil); }
  assert.deepEqual(s.counts(), before); assert.ok(Math.abs(totalMass(s) - mass) < 1e-7);
});

test('different masses experience identical free-fall acceleration', () => {
  const light = new Simulation(40, 80), heavy = new Simulation(40, 80);
  block(light, 15, 5, 5, 5, M.Wood); block(heavy, 15, 5, 5, 5, M.Stone);
  step(light, 35); step(heavy, 35);
  const a = body(light, 'Wood'), b = body(heavy, 'Stone');
  assert.ok(b.mass > a.mass * 3); assert.equal(a.minY, b.minY); assert.equal(a.velocity, b.velocity);
});

test('clearing the scene resets body momentum before rebuilding at the same position', () => {
  const s = new Simulation(40, 80); block(s, 15, 5, 5, 5, M.Stone); step(s, 20);
  const old = body(s, 'Stone'); assert.ok(old.velocity > 0);
  s.clear(); block(s, old.minX, old.minY, 5, 5, M.Stone);
  assert.equal(body(s, 'Stone').velocity, 0);
  s.step(); assert.equal(body(s, 'Stone').velocity, .06);
});

test('a heavy load makes a floating wood piece sink', () => {
  const s = new Simulation(60, 70);
  block(s, 0, 69, 60, 1, M.Glass); block(s, 0, 30, 60, 39, M.Water);
  block(s, 20, 28, 10, 10, M.Wood); block(s, 23, 23, 5, 5, M.Stone);
  step(s, 1000);
  const wood = body(s, 'Wood');
  assert.ok(wood.maxY >= 65, `loaded wood should sink: ${JSON.stringify(wood)}`);
  assert.ok(wood.carriedMass > 0);
});

test('buoyant wood lifts a small load instead of being pinned underwater', () => {
  const s = pool(M.Wood); s.set(34, 41, M.Stone); step(s, 1000);
  const wood = body(s, 'Wood'), stone = s.bodySummaries(100).find(b => b.material === 'Stone' && b.cells === 1)!;
  assert.ok(wood.minY < 30, `wood should lift its small load: ${JSON.stringify(wood)}`);
  assert.equal(stone.maxY + 1, wood.minY);
});

test('sufficient body weight pushes loose sand aside; a lighter piece rests on it', () => {
  const make = (type: number) => { const s = new Simulation(20, 30); block(s, 0, 29, 20, 1, M.Glass); block(s, 7, 21, 3, 8, M.Sand); block(s, 7, 18, 3, 3, type); return s; };
  const light = make(M.Wood), heavy = make(M.Stone);
  step(light, 40); step(heavy, 40);
  assert.ok(body(heavy, 'Stone').maxY > body(light, 'Wood').maxY);
  assert.equal(heavy.counts().Sand, light.counts().Sand);
});
