import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/engine/simulation.ts';
import { labConfig } from '../src/demo/materials.ts';
import { loadScene } from '../src/demo/scenes.ts';

test('native cold-tree combustion bookkeeping stays near the legacy ignition cost', t => {
  const legacy = JSON.parse(readFileSync(new URL('./fixtures/legacy-lab-config.json', import.meta.url), 'utf8'));
  const old = new Simulation(legacy,960,576), current = new Simulation(labConfig,960,576);
  for(const s of [old,current]){loadScene(s,'fir');for(let i=0;i<45;i++)s.step();}
  let oldMs=0,newMs=0;
  for(let i=0;i<90;i++){
    let start=performance.now();old.step();oldMs+=performance.now()-start;
    start=performance.now();current.step();newMs+=performance.now()-start;
  }
  t.diagnostic(`960x576 cold tree mean: legacy ${(oldMs/90).toFixed(2)} ms; progressive ${(newMs/90).toFixed(2)} ms`);
  // Relative guard plus scheduler allowance, not a cross-device 60 FPS promise.
  assert.ok(newMs/90 < oldMs/90*1.6+2, 'cold fuel must not add active neighbor/emission work');
  assert.deepEqual(current.counts(),old.counts());assert.equal(current.reactions.ignition,0);
});

test('960x576 localized ignition preserves the tree at ten seconds with bounded update cost', t => {
  const s = new Simulation(labConfig,960,576);loadScene(s,'burn-tree');const wood=s.counts().Wood;
  const start=performance.now();for(let tick=0;tick<600;tick++)s.step();const mean=(performance.now()-start)/600;
  assert.equal(s.counts().Wood,wood);assert.ok(s.reactions.ignition>0);
  // Generous shared-runner guard for a catastrophic scan/allocation regression.
  assert.ok(mean<100, `native tree update averaged ${mean.toFixed(2)} ms`);
  t.diagnostic(`native burning tree: ${wood} wood cells retained; ${mean.toFixed(2)} ms/update including cold start`);
});
