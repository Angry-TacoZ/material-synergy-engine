import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Simulation } from '../src/simulation.ts';

// Captured before the config migration. Do not regenerate to accept regressions.
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/material-baseline.json', import.meta.url), 'utf8'));
const digest = (a: ArrayBufferView) => createHash('sha256').update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
for (const fixture of fixtures) test(`pre-migration behavior is identical: ${fixture.name}`, () => {
  const s = new Simulation(fixture.width, fixture.height, 42); s.load(fixture.preset);
  for (const [x, y, type] of fixture.placements) s.set(x, y, type);
  for (let tick = 0; tick < fixture.ticks; tick++) s.step();
  assert.deepEqual({ cells: digest(s.cells), life: digest(s.life), temperature: digest(s.temperature), uv: digest(s.surfaceUV), counts: s.counts(), reactions: s.reactions, nextRandom: s.random() }, fixture.expected);
});
