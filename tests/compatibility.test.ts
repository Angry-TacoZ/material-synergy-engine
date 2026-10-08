import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Simulation } from '../src/engine/index.ts';
import { labConfig } from '../src/demo/materials.ts';
import { loadScene } from '../src/demo/scenes.ts';

// Captured before the config migration. Do not regenerate to accept regressions.
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/material-baseline.json', import.meta.url), 'utf8'));
const digest = (a: ArrayBufferView) => createHash('sha256').update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
for (const fixture of fixtures) test(`pre-migration behavior is identical: ${fixture.name}`, () => {
  const legacyConfig = structuredClone(labConfig);
  for (const material of legacyConfig.materials) delete material.thermal.heatIgnition;
  const s = new Simulation(legacyConfig, fixture.width, fixture.height, 42); loadScene(s, fixture.preset);
  for (const [x, y, type] of fixture.placements) s.set(x, y, type);
  for (let tick = 0; tick < fixture.ticks; tick++) s.step();
  assert.deepEqual({ cells: digest(s.copyCells()), life: digest(s.life), temperature: digest(s.temperature), uv: digest(s.surfaceUV), counts: s.counts(), reactions: s.reactions, nextRandom: s.random() }, fixture.expected);
});
