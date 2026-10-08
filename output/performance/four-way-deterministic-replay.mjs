import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const repo = process.cwd();
const out = resolve(repo, 'output/performance');
const defaultWorktreeBase = 'C:/Users/angry/AppData/Local/Temp/mse-four-way-evaluation-20261008';
const ids = ['A', 'B', 'C', 'D'];
const dirs = Object.fromEntries(ids.map(id => [id, process.env[`MSE_${id}_ROOT`] ?? join(defaultWorktreeBase, {
  A: 'A-baseline', B: 'B-cpu', C: 'C-worker', D: 'D-combined',
}[id])]));
const commits = {
  A: 'e32546a130b93288ca67bf427f035d5aff70d9ff',
  B: '89d3c9fbd62b95bd4d7102bd71e020b93186407a',
  C: '6fdbcc915ef61cfc42d2358e3cd8a6a6df6bfd01',
  D: '8edf80c802050502acfa84ca14f9154ea9b51566',
};
const line = (y, start, end, step) => Array.from({ length: Math.floor((end - start) / step) + 1 }, (_, i) => [start + i * step, y]);
const allWorkloads = [
  { id: 'empty', preset: 'empty', ticks: 120 },
  { id: 'landscape', preset: 'landscape', ticks: 120 },
  { id: 'fracture', preset: 'fracture', ticks: 120 },
  { id: 'fir', preset: 'fir', ticks: 120 },
  { id: 'fire', preset: 'fire', ticks: 120 },
  { id: 'water', preset: 'water', ticks: 120 },
  { id: 'float', preset: 'float', ticks: 120 },
  { id: 'heat', preset: 'heat', ticks: 120 },
  { id: 'ignite', preset: 'ignite', ticks: 300 },
  { id: 'tip', preset: 'tip', ticks: 120 },
  { id: 'stress', preset: 'stress', ticks: 120 },
  { id: 'shatter', preset: 'shatter', ticks: 240 },
  { id: 'stress-dense-liquids', ticks: 120, setup: [
    ['water', 25, [...line(380, 70, 890, 55), ...line(430, 70, 890, 55), ...line(480, 70, 890, 55), ...line(530, 70, 890, 55)]],
  ] },
  { id: 'stress-connected-structure', ticks: 120, setup: [
    ['concrete', 18, [...line(355, 120, 840, 28), ...line(470, 355, 495, 18), ...line(840, 355, 495, 18), ...line(420, 420, 550, 26)]],
  ] },
  { id: 'stress-fragmentation', ticks: 240, setup: [
    ['concrete', 18, line(545, 100, 860, 28)],
    ['glass', 22, [...line(265, 260, 695, 38), ...line(300, 300, 660, 38)]],
  ] },
  { id: 'stress-combustion', ticks: 180, setup: [
    ['stone', 18, line(540, 100, 860, 34)],
    ['wood', 20, [...line(430, 130, 830, 38), ...line(470, 130, 830, 38), ...line(510, 130, 830, 38)]],
    ['lava', 10, [[160, 400], [205, 400], [250, 400], [295, 400]]],
  ] },
  { id: 'stress-vapor', ticks: 180, setup: [
    ['stone', 16, line(535, 140, 820, 38)],
    ['water', 22, [...line(500, 240, 450, 40), ...line(500, 510, 800, 50)]],
    ['lava', 14, [[280, 500], [500, 480], [720, 500]]],
    ['wood', 14, [[150, 480], [190, 480], [850, 480]]],
  ] },
  { id: 'stress-reactions', ticks: 180, setup: [
    ['stone', 12, [[115, 530], [335, 530], [555, 530], [775, 530]]],
    ['wood', 14, [[155, 420], [195, 420], [330, 300], [370, 300]]],
    ['lava', 9, [[155, 393], [370, 273], [555, 500], [775, 500]]],
    ['water', 13, [[330, 420], [370, 420], [595, 500]]],
    ['salt', 8, [[370, 420], [610, 480]]],
    ['ice', 12, [[720, 420], [790, 420]]],
    ['acid', 8, [[115, 500], [335, 500]]],
    ['concrete', 10, [[115, 480], [335, 480]]],
  ] },
];
const selectedWorkloadIds = process.env.MSE_REPLAY_WORKLOADS?.split(',').filter(Boolean);
const workloads = selectedWorkloadIds
  ? allWorkloads.filter(workload => selectedWorkloadIds.includes(workload.id))
  : allWorkloads;
if (selectedWorkloadIds && workloads.length !== selectedWorkloadIds.length) throw new Error('Unknown workload id in MSE_REPLAY_WORKLOADS.');

async function loadVariant(id) {
  const root = dirs[id];
  const [simulation, materials, scenes] = await Promise.all([
    import(pathToFileURL(join(root, 'src/engine/simulation.ts')).href),
    import(pathToFileURL(join(root, 'src/demo/materials.ts')).href),
    import(pathToFileURL(join(root, 'src/demo/scenes.ts')).href),
  ]);
  return { Simulation: simulation.Simulation, labConfig: materials.labConfig, loadScene: scenes.loadScene, M: materials.M };
}

function prepare(variant, workload, width, height, seed) {
  const sim = new variant.Simulation(variant.labConfig, width, height, seed);
  if (workload.preset) variant.loadScene(sim, workload.preset);
  else {
    variant.loadScene(sim, 'empty');
    for (const [name, radius, points] of workload.setup) {
      const type = sim.materialId(name);
      for (const [x, y] of points) sim.paint(x, y, radius, type);
    }
  }
  return sim;
}

function bytes(view) { return Buffer.from(view.buffer, view.byteOffset, view.byteLength); }
function firstTypedDifference(a, b) {
  if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b)) return { expectedType: a?.constructor?.name, actualType: b?.constructor?.name };
  if (a.constructor !== b.constructor || a.length !== b.length) return { expectedLength: a.length, actualLength: b.length, expectedType: a.constructor.name, actualType: b.constructor.name };
  const left = bytes(a), right = bytes(b);
  if (Buffer.compare(left, right) === 0) return null;
  let offset = 0;
  while (offset < left.length && left[offset] === right[offset]) offset++;
  const cell = Math.floor(offset / a.BYTES_PER_ELEMENT);
  return { byteOffset: offset, index: cell, expected: a[cell], actual: b[cell] };
}

function firstObjectDifference(a, b, path = '') {
  if (Object.is(a, b)) return null;
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    const difference = firstTypedDifference(a, b);
    return difference ? { path, ...difference } : null;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return { path, expected: a, actual: b };
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const key of keys) {
    if (!(key in a) || !(key in b)) return { path: path ? `${path}.${key}` : key, expectedPresent: key in a, actualPresent: key in b };
    const difference = firstObjectDifference(a[key], b[key], path ? `${path}.${key}` : key);
    if (difference) return difference;
  }
  return null;
}

function bodyState(sim) {
  return sim.solidGroups.map(body => ({
    cells: body.cells, type: body.type, mass: body.mass, load: body.load,
    displacedMass: body.displacedMass, buoyantLoad: body.buoyantLoad,
    movedTick: body.movedTick, velocity: body.velocity, travel: body.travel,
    top: body.top, bottom: body.bottom, rows: body.rows,
    angularVelocity: body.angularVelocity, angle: body.angle,
    buoyancyX: body.buoyancyX, buoyancyY: body.buoyancyY,
    pose: body.pose, tilted: body.tilted, stressKey: body.stressKey,
    collisionVelocity: body.collisionVelocity,
  }));
}

function snapshot(sim) {
  const internal = sim;
  const thermal = internal.thermal;
  return {
    arrays: {
      cells: sim.cells, life: sim.life, moved: sim.moved, surfaceUV: sim.surfaceUV,
      temperature: sim.temperature, nextTemperature: internal.nextTemperature,
      fusionHeat: internal.fusionHeat, ignitionExposure: internal.ignitionExposure,
      owners: internal.owners, nextOwners: internal.nextOwners,
      thermalHeat: thermal.heat, thermalNext: thermal.next, thermalSources: thermal.sources,
    },
    scalars: {
      ticks: sim.ticks, revision: sim.revision, seed: internal.seed,
      solidRevision: internal.solidRevision, groupedRevision: internal.groupedRevision,
      thermalActive: thermal.active,
    },
    reactions: { ...sim.reactions },
    bodies: bodyState(sim),
    pendingShatter: [...internal.pendingShatter].map(body => internal.solidGroups.indexOf(body)),
  };
}

function verifyIndexes(sim) {
  const internal = sim;
  if (!(internal.ignitionBits instanceof Uint32Array) || !(internal.occupiedBits instanceof Uint32Array)) return null;
  const expectedIgnition = new Uint32Array(Math.ceil(sim.cells.length / 32));
  const expectedOccupied = new Uint32Array(sim.height * internal.rowWordCount);
  for (let i = 0; i < sim.cells.length; i++) {
    const type = sim.cells[i], x = i % sim.width, y = Math.floor(i / sim.width);
    if (sim.materials[type].thermal.heatIgnition) expectedIgnition[i >>> 5] |= 1 << (i & 31);
    if (type) expectedOccupied[y * internal.rowWordCount + (x >>> 5)] |= 1 << (x & 31);
  }
  const ignition = firstTypedDifference(internal.ignitionBits, expectedIgnition);
  if (ignition) return { path: 'ignitionBits', ...ignition };
  const occupied = firstTypedDifference(internal.occupiedBits, expectedOccupied);
  if (occupied) return { path: 'occupiedBits', ...occupied };
  return null;
}

await mkdir(out, { recursive: true });
const detailFile = resolve(out, process.env.MSE_REPLAY_DETAIL_FILE ?? 'four-way-correctness-ticks-20261008.jsonl');
const summaryFile = resolve(out, process.env.MSE_REPLAY_SUMMARY_FILE ?? 'four-way-correctness-summary-20261008.json');
const width = 960, height = 576, seed = 42;
const variants = Object.fromEntries(await Promise.all(ids.map(async id => [id, await loadVariant(id)])));
const configHashes = Object.fromEntries(ids.map(id => [id, createHash('sha256').update(JSON.stringify(variants[id].labConfig)).digest('hex')]));
if (new Set(Object.values(configHashes)).size !== 1) throw new Error(`Material/reaction configuration differs between variants: ${JSON.stringify(configHashes)}`);

const pairings = [['A', 'B'], ['A', 'C'], ['A', 'D'], ['B', 'D']];
const results = [];
for (const workload of workloads) {
  const sims = Object.fromEntries(ids.map(id => [id, prepare(variants[id], workload, width, height, seed)]));
  const stateAtStart = Object.fromEntries(ids.map(id => [id, snapshot(sims[id])]));
  const initialDifferences = [];
  for (const [left, right] of pairings) {
    const difference = firstObjectDifference(stateAtStart[left], stateAtStart[right]);
    if (difference) initialDifferences.push({ left, right, tick: 0, ...difference });
  }
  const indexDifferences = [];
  for (const id of ['B', 'D']) {
    const difference = verifyIndexes(sims[id]);
    if (difference) indexDifferences.push({ configuration: id, tick: 0, ...difference });
  }
  const firstDivergences = [...initialDifferences];
  const started = performance.now();
  for (let tick = 1; tick <= workload.ticks; tick++) {
    for (const id of ids) sims[id].step();
    const states = Object.fromEntries(ids.map(id => [id, snapshot(sims[id])]));
    for (const [left, right] of pairings) {
      if (firstDivergences.some(x => x.left === left && x.right === right)) continue;
      const difference = firstObjectDifference(states[left], states[right]);
      if (difference) firstDivergences.push({ left, right, tick, ...difference });
    }
    if (tick % 30 === 0 || tick === workload.ticks) {
      for (const id of ['B', 'D']) {
        if (indexDifferences.some(x => x.configuration === id)) continue;
        const difference = verifyIndexes(sims[id]);
        if (difference) indexDifferences.push({ configuration: id, tick, ...difference });
      }
    }
  }
  const result = {
    workload: workload.id, width, height, seed, ticks: workload.ticks,
    configHashes, initialDifferences, firstDivergences, indexDifferences,
    elapsedMs: performance.now() - started,
    finalTicks: Object.fromEntries(ids.map(id => [id, sims[id].ticks])),
    finalCounts: Object.fromEntries(ids.map(id => [id, sims[id].counts()])),
    finalReactions: Object.fromEntries(ids.map(id => [id, { ...sims[id].reactions }])),
  };
  results.push(result);
  await appendFile(detailFile, JSON.stringify(result) + '\n');
  console.log(`REPLAY ${workload.id} ticks=${workload.ticks} mismatches=${firstDivergences.length} bitmap=${indexDifferences.length} ${Math.round(result.elapsedMs)}ms`);
}

const summary = {
  createdAt: new Date().toISOString(), width, height, seed, commits,
  workloadCount: workloads.length,
  workloads: results,
  exactAgreement: results.every(r => !r.initialDifferences.length && !r.firstDivergences.length && !r.indexDifferences.length),
  scope: 'Direct deterministic engine replay across all four commits. Worker protocol is evaluated separately in the browser harness.',
};
await writeFile(summaryFile, JSON.stringify(summary, null, 2));
console.log(`COMPLETE exactAgreement=${summary.exactAgreement} detail=${detailFile} summary=${summaryFile}`);
