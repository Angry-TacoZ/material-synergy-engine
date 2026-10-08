import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation as EngineSimulation, type MaterialDefinition, type WorldConfig } from '../src/engine/index.ts';
import { Simulation, M } from '../src/simulation.ts';

const definition = (key: string, state: MaterialDefinition['state']): MaterialDefinition => ({
  key, name: key, state, density: state === 'Empty' ? 0 : 1000,
  thermal: { initialTemperature: 0, capacity: 1, conductivity: .12, airTransfer: .16 },
});

for (const phase of [0, 1, 2]) for (const holdTicks of [1, 2, 4, 9]) test(`hot fuel waits exactly ${holdTicks} steps when placed at phase ${phase}`, () => {
  const fuel = definition('fuel', 'Solid');
  fuel.thermal = { initialTemperature: 500, capacity: 1, conductivity: 0, airTransfer: 0,
    heatIgnition: { point: 200, holdTicks, output: 'burnt', counter: 'heated' } };
  const s = new EngineSimulation({ materials: [definition('void', 'Empty'), fuel, definition('burnt', 'Solid')], reactions: [] }, 24, 12);
  for (let tick = 0; tick < phase; tick++) s.step();
  s.set(15, 11, s.materialId('fuel'));
  for (let tick = 0; tick < holdTicks - 1; tick++) s.step();
  assert.equal(s.cells[11 * s.width + 15], s.materialId('fuel'), 'must wait for the configured exposure');
  s.step();
  assert.equal(s.cells[11 * s.width + 15], s.materialId('burnt'));
  assert.equal(s.reactions.heated, 1);
});

test('a test-only material ignites after sustained heat without contact, then resets after cooling', () => {
  const config: WorldConfig = { materials: [definition('void', 'Empty'), definition('heater', 'Solid'), definition('fiber', 'Solid'), definition('flame', 'Gas')], reactions: [] };
  config.materials[1].thermal = { initialTemperature: 600, source: true, capacity: 1, conductivity: .12, airTransfer: .16 };
  config.materials[2].thermal.heatIgnition = { point: 200, holdTicks: 9, output: 'flame', counter: 'heated' };
  const s = new EngineSimulation(config, 24, 12);
  s.set(1, 11, s.materialId('heater')); s.set(15, 11, s.materialId('fiber'));
  const target = 11 * s.width + 15;
  s.temperature[target] = 500;
  for (let i = 0; i < 6; i++) s.step();
  assert.equal(s.reactions.heated, 0);
  s.temperature[target] = 0; for (let i = 0; i < 3; i++) s.step();
  s.temperature[target] = 500; for (let i = 0; i < 6; i++) s.step();
  assert.equal(s.reactions.heated, 0, 'cooling resets the accumulated exposure');
  s.temperature[target] = 500; for (let i = 0; i < 3; i++) s.step();
  assert.equal(s.reactions.heated, 1);
  assert.equal(s.cells[target], s.materialId('flame'));
  assert.equal(s.cells[11 * s.width + 1], s.materialId('heater'));
});

test('heat ignition config validates thresholds and outputs', () => {
  const base: WorldConfig = { materials: [definition('void', 'Empty'), definition('fiber', 'Solid')], reactions: [] };
  base.materials[1].thermal.heatIgnition = { point: 200, holdTicks: 9, output: 'void' };
  for (const holdTicks of [0, 1.5, 65536]) {
    const bad = structuredClone(base); bad.materials[1].thermal.heatIgnition!.holdTicks = holdTicks;
    assert.throws(() => new EngineSimulation(bad), /ignition hold ticks/);
  }
  const badOutput = structuredClone(base); badOutput.materials[1].thermal.heatIgnition!.output = 'missing';
  assert.throws(() => new EngineSimulation(badOutput), /Unknown material/);
  const badPoint = structuredClone(base); badPoint.materials[1].thermal.heatIgnition!.point = NaN;
  assert.throws(() => new EngineSimulation(badPoint), /ignition point/);
});

test('Particle Lab grass and wood ignite across separate air gaps', () => {
  const s = new Simulation(); s.load('ignite');
  assert.equal(s.cells[127 * s.width + 67], M.Empty);
  assert.equal(s.cells[127 * s.width + 172], M.Empty);
  const grass = s.counts().Grass, wood = s.counts().Wood;
  for (let tick = 0; tick < 300; tick++) {
    for (let i = 0; i < s.cells.length; i++) if (s.cells[i] === M.Lava) {
      const x = i % s.width, y = Math.floor(i / s.width);
      for (const n of [x ? i - 1 : -1, x + 1 < s.width ? i + 1 : -1, y ? i - s.width : -1, y + 1 < s.height ? i + s.width : -1]) {
        assert.ok(n < 0 || (s.cells[n] !== M.Grass && s.cells[n] !== M.Wood), `lava touched fuel at ${x},${y}`);
      }
    }
    s.step();
  }
  assert.ok(s.reactions.ignition > 0);
  assert.ok((s.counts().Grass ?? 0) < grass, 'grass heats and ignites');
  assert.ok((s.counts().Wood ?? 0) < wood, 'wood heats and ignites');
  for (let y = 122; y < 136; y++) {
    assert.notEqual(s.cells[y * s.width + 67], M.Lava);
    assert.notEqual(s.cells[y * s.width + 172], M.Lava);
  }
});

test('heat ignition replays deterministically from the same seed', () => {
  const a = new Simulation(), b = new Simulation();
  for (const s of [a, b]) { s.load('ignite'); for (let i = 0; i < 180; i++) s.step(); }
  assert.deepEqual(a.copyCells(), b.copyCells());
  assert.deepEqual(a.temperature, b.temperature);
  assert.deepEqual(a.reactions, b.reactions);
  assert.equal(a.random(), b.random());
});
