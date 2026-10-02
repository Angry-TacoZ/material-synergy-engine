import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, M } from '../src/simulation.ts';

const step = (s: Simulation, n: number) => { for (let i = 0; i < n; i++) s.step(); };
const scene = (gap: number, hot = true) => {
  const s = new Simulation(160, 40);
  for (let x = 0; x < 160; x++) s.set(x, 39, M.Stone);
  for (let y = 30; y < 39; y++) { s.set(11, y, M.Glass); s.set(20, y, M.Glass); }
  for (let y = 31; y < 39; y++) for (let x = 12; x < 20; x++) s.set(x, y, hot ? M.Lava : M.Glass);
  for (let y = 33; y < 39; y++) for (let x = 20 + gap; x < 26 + gap; x++) s.set(x, y, M.Ice);
  return s;
};

test('lava melts ice across an air gap before contact', () => {
  const s = scene(16); const before = s.counts().Ice;
  step(s, 180);
  assert.ok(s.reactions.melting > 0 && (s.counts().Ice ?? 0) < before);
  for (let i = 0; i < s.cells.length; i++) if (s.cells[i] === M.Lava) assert.ok(i % s.width < 20, 'lava remains in its original column, separated from ice');
});

test('heat falls off with distance and cold scenes do not melt spontaneously', () => {
  const near = scene(8), far = scene(100), cold = scene(8, false);
  step(near, 120); step(far, 120); step(cold, 120);
  assert.ok(near.reactions.melting > far.reactions.melting);
  assert.equal(far.reactions.melting, 0); assert.equal(cold.reactions.melting, 0);
});

test('temperature follows falling pieces and clearing removes residual heat', () => {
  const s = new Simulation(48, 48); s.set(15, 10, M.Glass); s.temperature[10 * 48 + 15] = 250;
  step(s, 6); assert.equal(s.temperature[11 * 48 + 15], 250);
  s.set(10, 47, M.Lava); step(s, 30); assert.ok(s.temperatureAt(18, 46) > 0);
  s.clear(); assert.equal(s.temperatureAt(18, 46), 0); assert.ok(s.temperature.every(t => t === 0));
});

test('thermal updates stay bounded and are deterministic', () => {
  const a = scene(16), b = scene(16); step(a, 180); step(b, 180);
  assert.deepEqual(a.cells, b.cells); assert.deepEqual(a.temperature, b.temperature);
  assert.ok(a.temperature.every(t => Number.isFinite(t) && t >= -10 && t <= 1200));
});
