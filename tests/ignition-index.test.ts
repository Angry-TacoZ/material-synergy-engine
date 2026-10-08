import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, M } from '../src/simulation.ts';
import { Simulation as EngineSimulation, type MaterialDefinition, type WorldConfig } from '../src/engine/index.ts';

type IgnitionIndex = { ignitionBits: Uint32Array; occupiedBits: Uint32Array; rowWordCount: number };

class CapturingCellsBuffer extends Uint8Array {
  capturedSource?: ArrayLike<number>;
  override set(source: ArrayLike<number>, offset = 0) {
    this.capturedSource = source;
    super.set(source, offset);
  }
}

function assertIgnitionIndex(sim: EngineSimulation) {
  const index = sim as unknown as IgnitionIndex;
  const expected = new Uint32Array(Math.ceil(sim.cells.length / 32));
  const occupied = new Uint32Array(sim.height * index.rowWordCount);
  for (let cell = 0; cell < sim.cells.length; cell++) {
    const x = cell % sim.width, y = Math.floor(cell / sim.width), bit = 1 << (x & 31);
    if (sim.materials[sim.cells[cell]].thermal.heatIgnition) expected[cell >>> 5] |= 1 << (cell & 31);
    if (sim.cells[cell]) occupied[y * index.rowWordCount + (x >>> 5)] |= bit;
  }
  assert.deepEqual(index.ignitionBits, expected, 'ignitable-material bitmap');
  assert.deepEqual(index.occupiedBits, occupied, 'occupied-cell bitmap');
}

test('heat-ignition index follows placement, reactions, burning, and clear', () => {
  const sim = new Simulation(96, 72);
  sim.set(12, 20, M.Wood);
  sim.set(18, 20, M.Grass);
  sim.set(22, 20, M.Water);
  assertIgnitionIndex(sim);

  sim.load('ignite');
  assertIgnitionIndex(sim);
  for (let tick = 0; tick < 300; tick++) {
    sim.step();
    if (tick % 10 === 0) assertIgnitionIndex(sim);
  }
  assert.ok(sim.reactions.ignition > 0);
  sim.clear();
  assertIgnitionIndex(sim);
  assert.equal(sim.cells.every(cell => cell === M.Empty), true);
});

test('cell reads are immutable and controlled writes keep the occupied index synchronized', () => {
  const sim = new Simulation(32, 32);
  sim.fill(M.Wood);
  assertIgnitionIndex(sim);
  sim.clear();
  assertIgnitionIndex(sim);

  assert.throws(() => Reflect.set(sim.cells, '80', M.Sand), /read-only/);
  const snapshot = sim.cells.slice();
  snapshot[80] = M.Sand;
  assert.equal(sim.cells[80], M.Empty, 'mutating a copied snapshot cannot mutate the world');

  sim.set(16, 2, M.Sand);
  assert.equal(sim.cells[80], M.Sand);
  assertIgnitionIndex(sim);
  sim.step();
  assert.equal(sim.cells[112], M.Sand, 'controlled placement is discovered by the occupied-cell index');
  assertIgnitionIndex(sim);
});

test('copyCellsTo does not expose its private backing array to caller overrides', () => {
  const sim = new Simulation(32, 32), target = new CapturingCellsBuffer(32 * 32);
  sim.set(16, 2, M.Sand);
  sim.copyCellsTo(target);
  assert.equal(target[80], M.Sand, 'the caller-owned buffer receives a copy');
  assert.equal(target.capturedSource, undefined, 'the target override cannot capture private cell storage');
  sim.step();
  assert.equal(sim.cells[112], M.Sand, 'copying does not corrupt the occupied-cell index');
  assertIgnitionIndex(sim);
});

test('moving ignition-capable gases retain their indexed cells after swaps', () => {
  const material = (key: string, state: MaterialDefinition['state']): MaterialDefinition => ({
    key, name: key, state, density: state === 'Empty' ? 0 : 1,
    thermal: { initialTemperature: 0, conductivity: 0, capacity: 1, airTransfer: 0 },
  });
  const fuel = material('fuel', 'Gas');
  fuel.thermal.heatIgnition = { point: 1000, holdTicks: 100, output: 'spent' };
  const config: WorldConfig = { materials: [material('void', 'Empty'), fuel, material('spent', 'Gas')], reactions: [] };
  const sim = new EngineSimulation(config, 48, 64);
  for (let x = 4; x < 44; x += 2) sim.set(x, 55, sim.materialId('fuel'));
  assertIgnitionIndex(sim);
  for (let tick = 0; tick < 20; tick++) {
    sim.step();
    assertIgnitionIndex(sim);
  }
});
