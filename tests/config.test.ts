import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, type MaterialDefinition, type WorldConfig } from '../src/engine/index.ts';
import { labConfig } from '../src/demo/materials.ts';

const material = (key: string, state: MaterialDefinition['state'] = 'Solid'): MaterialDefinition => ({ key, name: key, state, density: state === 'Empty' ? 0 : 1000, thermal: { initialTemperature: 0, capacity: 1, conductivity: .12, airTransfer: .16 } });
const world = (): WorldConfig => ({ materials: [material('void', 'Empty'), material('catalyst'), material('target'), material('product', 'Powder')], reactions: [{ inputs: { self: ['catalyst'], neighbor: ['target'] }, conditions: { minTemperature: 50, maxTemperature: 100 }, outputs: [{ target: 'neighbor', material: 'product' }, { target: 'self', material: 'void' }], counter: 'custom', stop: true }] });

test('a test-only solid material reacts entirely through config with temperature conditions', () => {
  const s = new Simulation(world(), 8, 8);
  s.set(3, 7, s.materialId('catalyst')); s.set(4, 7, s.materialId('target'));
  s.step(); assert.equal(s.reactions.custom, 0);
  s.temperature[7 * 8 + 3] = 101; s.step(); assert.equal(s.reactions.custom, 0);
  s.temperature[7 * 8 + 3] = 75; s.step();
  assert.equal(s.reactions.custom, 1); assert.deepEqual(s.counts(), { product: 1 });
});

test('custom flammability and ordered precipitation outputs are config data', () => {
  const config = world(); config.materials[2].thermal.flammability = { output: 'product' };
  config.reactions = [{ inputs: { self: ['catalyst'], neighbor: { flammable: true } }, outputs: [{ target: 'neighbor', material: '$flammability' }, { target: 'empty-neighbor', material: 'product' }], counter: 'burn', stop: true }];
  const s = new Simulation(config, 8, 8); s.set(3, 7, 1); s.set(4, 7, 2); s.step();
  assert.equal(s.reactions.burn, 1); assert.equal(s.counts().product, 2);
});

test('custom thermal sources, conductivity and phase thresholds melt a new material', () => {
  const config = world(); config.reactions = [];
  config.materials[1].thermal = { initialTemperature: 600, source: true, capacity: 1, conductivity: .12, airTransfer: .16 };
  config.materials[2].thermal.phaseChange = { point: 20, heat: 2, output: 'product', counter: 'phase' };
  const s = new Simulation(config, 24, 12); s.set(8, 11, 1); s.set(10, 11, 2);
  for (let i = 0; i < 30; i++) s.step();
  assert.equal(s.reactions.phase, 1); assert.equal(s.counts().target, undefined);
  const insulated = structuredClone(config); insulated.materials[2].thermal.airTransfer = 0; insulated.materials[2].thermal.conductivity = 0;
  const cold = new Simulation(insulated, 24, 12); cold.set(8, 11, 1); cold.set(10, 11, 2);
  for (let i = 0; i < 30; i++) cold.step();
  assert.equal(cold.reactions.phase, 0);
});

test('custom lifetime and impact failure work without built-in identities', () => {
  const config = world(); config.reactions = [];
  config.materials[1].collision = { hard: true };
  config.materials[2].failure = { impact: { minRelativeSpeed: .5, output: 'product', counter: 'break' } };
  const s = new Simulation(config, 12, 40); s.set(5, 39, 1); s.set(5, 2, 2);
  for (let i = 0; i < 60; i++) s.step();
  assert.equal(s.reactions.break, 1); assert.equal(s.counts().target, undefined);
  const expiring = world(); expiring.reactions = []; expiring.materials[1].lifetime = { min: 2, range: 0, output: 'product', counter: 'expired' };
  const life = new Simulation(expiring, 8, 8); life.set(2, 7, 1); life.step(); life.step();
  assert.equal(life.reactions.expired, 1);
});

test('custom compression and bending strengths drive stress failure', () => {
  const config = world(); config.reactions = [];
  config.materials[2].failure = { stress: { compression: .001, bending: .001, interval: 1, minCells: 1, sectionRadius: 2, limit: 1, fraction: 1, output: 'product', counter: 'stress' } };
  const s = new Simulation(config, 8, 8); s.set(3, 7, 2); s.set(3, 6, 2); s.step();
  assert.equal(s.reactions.stress, 1); assert.equal(s.counts().product, 1);
  config.materials[2].failure!.stress!.compression = 1e9; config.materials[2].failure!.stress!.bending = 1e9;
  const strong = new Simulation(config, 8, 8); strong.set(3, 7, 2); strong.set(3, 6, 2); strong.step();
  assert.equal(strong.reactions.stress, 0);
});

test('material IDs can be reordered without changing keyed behavior or random sequence', () => {
  const reordered = { ...labConfig, materials: [labConfig.materials[0], ...labConfig.materials.slice(1).reverse()] };
  const a = new Simulation(labConfig, 20, 20), b = new Simulation(reordered, 20, 20);
  for (const s of [a, b]) {
    for (const [x, key] of [[7, 'oil'], [8, 'sand'], [9, 'lava'], [10, 'saltwater'], [14, 'acid'], [15, 'grass']] as const) s.set(x, 19, s.materialId(key));
    for (let tick = 0; tick < 60; tick++) s.step();
  }
  assert.deepEqual(Array.from(a.cells, id => a.materials[id].key), Array.from(b.cells, id => b.materials[id].key));
  assert.deepEqual(a.temperature, b.temperature); assert.deepEqual(a.life, b.life); assert.deepEqual(a.reactions, b.reactions); assert.equal(a.random(), b.random());
});

test('probabilistic custom reactions replay deterministically and source config is isolated', () => {
  const config = world(); config.reactions[0].conditions = { probability: .5 };
  const a = new Simulation(config, 8, 8, 123), b = new Simulation(config, 8, 8, 123);
  config.materials[2].thermal.initialTemperature = 999; config.reactions = [];
  for (const s of [a, b]) { s.set(3, 7, 1); s.set(4, 7, 2); for (let i = 0; i < 20; i++) s.step(); }
  assert.deepEqual(a.cells, b.cells); assert.equal(a.reactions.custom, 1); assert.equal(a.random(), b.random());
  assert.equal(a.materials[2].thermal.initialTemperature, 0); assert.ok(Object.isFrozen(a.materials[2].thermal));
});

test('invalid material references and thresholds fail before running', () => {
  const bad = world(); bad.reactions = [{ inputs: { self: ['absent'], neighbor: ['target'] }, outputs: [] }];
  assert.throws(() => new Simulation(bad), /Unknown material/);
  const output = world(); output.reactions[0].outputs[0].material = 'absent'; assert.throws(() => new Simulation(output), /Unknown material/);
  const strength = world(); strength.materials[2].failure = { impact: { minRelativeSpeed: NaN, output: 'product' } }; assert.throws(() => new Simulation(strength), /impact threshold/);
  const probability = world(); probability.reactions[0].conditions = { probability: 2 }; assert.throws(() => new Simulation(probability), /probability/);
});
