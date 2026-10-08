import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, M } from '../src/simulation.ts';

test('higher-resolution presets preserve layout and ignite wood', () => {
  const base = new Simulation(), fine = new Simulation(960, 576);
  base.load('fire'); fine.load('fire');
  assert.equal(fine.counts().Wood, base.counts().Wood * 16);
  fine.step(); assert.ok(fine.reactions.ignition > 0);
  fine.load('empty'); assert.deepEqual(fine.counts(), {});
});

test('lava ignites wood, and the fire spreads through fuel', () => {
  const s = new Simulation(20, 20); s.set(10, 19, M.Lava); s.set(11, 19, M.Wood); s.set(12, 19, M.Wood);
  s.step(); assert.ok(s.reactions.ignition >= 1); assert.equal(s.cells[19 * 20 + 11], M.Fire);
  for (let i = 0; i < 10; i++) s.step(); assert.ok(s.reactions.ignition >= 2);
});
test('water cools lava into stone and steam', () => {
  const s = new Simulation(20, 20); s.set(10, 19, M.Lava); s.set(11, 19, M.Water); s.step();
  assert.equal(s.cells[19 * 20 + 10], M.Stone); assert.equal(s.counts().Steam, 1); assert.equal(s.reactions.cooling, 1);
});
test('heat melts ice and fuses sand', () => {
  const s = new Simulation(20, 20); s.set(10, 19, M.Lava); s.set(9, 19, M.Ice); s.set(11, 19, M.Sand); s.step();
  assert.equal(s.reactions.melting, 1); assert.equal(s.reactions.glass, 1); assert.equal(s.cells[19 * 20 + 11], M.Glass);
});
test('salt dissolves into water', () => {
  const s = new Simulation(20, 20); s.set(10, 19, M.Salt); s.set(11, 19, M.Water); s.step();
  assert.equal(s.counts().Saltwater, 1); assert.equal(s.counts().Salt, undefined);
});
test('water extinguishes fire and oil ignites', () => {
  const s = new Simulation(20, 20); s.set(10, 19, M.Fire); s.set(11, 19, M.Water); s.step();
  assert.equal(s.counts().Fire, undefined); assert.equal(s.counts().Steam, 1);
  s.clear(); s.set(10, 19, M.Lava); s.set(11, 19, M.Oil); s.step(); assert.equal(s.reactions.ignition, 1);
});
test('water settles below oil, and trapped steam condenses', () => {
  const s = new Simulation(5, 5); s.set(2, 3, M.Water); s.set(2, 4, M.Oil); s.step(); assert.equal(s.cells[4 * 5 + 2], M.Water);
  s.clear(); s.fill(M.Stone); s.set(2, 2, M.Steam); s.life[2 * 5 + 2] = 1; s.step(); assert.equal(s.cells[2 * 5 + 2], M.Water);
});

test('steam rises and disperses without disappearing inside the workspace', () => {
  const s = new Simulation(80, 80);
  s.paint(40, 55, 6, M.Steam);
  const initialCount = s.counts().Steam;
  const meanHeight = () => { let total = 0; for (let i = 0; i < s.cells.length; i++) if (s.cells[i] === M.Steam) total += Math.floor(i / s.width); return total / initialCount; };
  const before = meanHeight();
  for (let i = 0; i < 30; i++) s.step();
  assert.equal(s.counts().Steam, initialCount);
  assert.ok(meanHeight() < before - 5);
  const columns = new Set<number>(); for (let i = 0; i < s.cells.length; i++) if (s.cells[i] === M.Steam) columns.add(i % s.width);
  assert.ok(columns.size > 13, 'steam spreads beyond its original brush width');
});
test('powders and solids fall, painting preserves matter, erasing clears', () => {
  const s = new Simulation(20, 20); s.set(3, 4, M.Sand); s.set(10, 10, M.Stone); s.step();
  assert.equal(s.cells[5 * 20 + 3], M.Sand);
  for (let i = 0; i < 5; i++) s.step(); assert.equal(s.cells[11 * 20 + 10], M.Stone);
  s.paint(10, 11, 2, M.Water); assert.equal(s.cells[11 * 20 + 10], M.Stone); s.paint(10, 11, 2, M.Empty); assert.equal(s.cells[11 * 20 + 10], 0);
});
test('seeded simulation is reproducible and remains in bounds', () => {
  const a = new Simulation(), b = new Simulation(); a.load('landscape'); b.load('landscape');
  for (let i = 0; i < 200; i++) { a.step(); b.step(); }
  assert.deepEqual(a.copyCells(), b.copyCells()); assert.ok(a.cells.every(t => t <= M.Shards));
  a.clear(); assert.equal(Object.keys(a.counts()).length, 0); assert.equal(a.reactions.ignition, 0);
});

test('connected solids retain their shape and stop at the floor', () => {
  for (const type of [M.Wood, M.Ice, M.Stone, M.Glass]) {
    const s = new Simulation(20, 20);
    for (let x = 5; x < 10; x++) s.set(x, 5, type);
    s.set(5, 6, type); for (let i = 0; i < 6; i++) s.step();
    for (let x = 5; x < 10; x++) assert.equal(s.cells[6 * 20 + x], type);
    assert.equal(s.cells[7 * 20 + 5], type);
    for (let i = 0; i < 25; i++) s.step();
    if (type === M.Glass) { assert.equal(s.counts()['Glass shards'], 6); continue; }
    assert.equal(s.counts()[type === M.Wood ? 'Wood' : type === M.Ice ? 'Ice' : type === M.Stone ? 'Stone' : 'Glass'], 6);
    const piece = s.bodySummaries()[0];
    assert.equal(piece.maxY, 19);
    assert.equal(s.bodySummaries().reduce((sum, b) => sum + b.cells, 0), 6);
    assert.ok(s.bodySummaries().some(b => Math.abs(b.angle) > 0), 'the L shape tips when its foot supports only one side');
  }
});
test('eroding a connection releases only the unsupported fragment', () => {
  const s = new Simulation(20, 20);
  for (let y = 8; y < 20; y++) s.set(5, y, M.Wood);
  for (let x = 5; x <= 12; x++) s.set(x, 8, M.Wood);
  s.set(8, 7, M.Acid); s.step();
  assert.equal(s.reactions.erosion, 1); assert.equal(s.counts().Acid, undefined);
  for (let i = 0; i < 5; i++) s.step();
  assert.equal(s.cells[8 * 20 + 7], M.Wood);
  assert.equal(s.cells[9 * 20 + 9], M.Wood);
  assert.equal(s.cells[8 * 20 + 9], 0);
});
test('solid chunks displace liquids without destroying either material', () => {
  const s = new Simulation(10, 10); s.set(5, 4, M.Stone); s.set(5, 5, M.Stone);
  for (let y = 6; y < 10; y++) for (let x = 0; x < 10; x++) s.set(x, y, M.Water);
  const before = s.counts(); for (let i = 0; i < 50; i++) { s.step(); assert.deepEqual(s.counts(), before); }
  assert.equal(s.cells[9 * 10 + 5], M.Stone); assert.equal(s.cells[8 * 10 + 5], M.Stone);
});
test('acid erodes rock, melts ice, and leaves glass intact', () => {
  for (const type of [M.Stone, M.Ice, M.Glass]) {
    const s = new Simulation(10, 10); s.set(5, 9, type); s.set(4, 9, M.Acid); s.step();
    assert.equal(s.reactions.erosion, type === M.Glass ? 0 : 1);
    if (type === M.Glass) assert.equal(s.counts().Glass, 1);
    if (type === M.Ice) assert.equal(s.counts().Water, 1);
  }
});
