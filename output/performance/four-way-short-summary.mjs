import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const input = resolve(root, process.argv[2] ?? 'output/performance/four-way-short-runs-20261008.jsonl');
const outputFile = resolve(root, process.argv[3] ?? 'output/performance/four-way-short-summary-20261008.json');
const scenes = ['empty', 'fire', 'float', 'stress'];
const configs = ['A', 'B', 'C', 'D'];
const titles = { empty: 'Blank canvas', fire: 'Lava & wood', float: 'Sink or float', stress: 'Concrete stress' };
const rows = (await readFile(input, 'utf8')).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
const key = row => `${row.repetition}/${row.configuration}/${row.workload}`;
const expected = new Set();
for (let rep = 1; rep <= 2; rep++) for (const config of configs) for (const scene of scenes) expected.add(`${rep}/${config}/${scene}`);
const found = new Set(rows.map(key));
const missing = [...expected].filter(id => !found.has(id));
const duplicates = rows.length - found.size;
const mismatchedDuration = rows.filter(row => row.durationTargetMs !== 15000 || Math.abs(row.actualElapsedMs - 15000) > 1500);
const nonzeroStart = rows.filter(row => row.startWorldTicks !== 0);
if (rows.length !== 32 || missing.length || duplicates || mismatchedDuration.length || nonzeroStart.length) {
  throw new Error(`Short matrix invalid: rows=${rows.length}/32, missing=${missing.length}, duplicates=${duplicates}, durationOutliers=${mismatchedDuration.length}, nonzeroStarts=${nonzeroStart.length}`);
}
const mean = values => values.reduce((total, value) => total + value, 0) / values.length;
const metrics = [
  ['simulationTps', row => row.simulationTps],
  ['uniqueWorldFrameFps', row => row.uniqueWorldFrameFps],
  ['displayFps', row => row.displayFps],
  ['p95FrameMs', row => row.frameIntervals.p95Ms],
  ['ticks', row => row.simulationTicks],
];
const byScene = {};
for (const scene of scenes) {
  byScene[scene] = {};
  for (const config of configs) {
    const group = rows.filter(row => row.workload === scene && row.configuration === config).sort((a, b) => a.repetition - b.repetition);
    byScene[scene][config] = {
      runs: group.map(row => ({
        repetition: row.repetition, simulationTps: row.simulationTps,
        uniqueWorldFrameFps: row.uniqueWorldFrameFps, displayFps: row.displayFps,
        p95FrameMs: row.frameIntervals.p95Ms, maxFrameMs: row.frameIntervals.maxMs,
        framesOver33ms: row.frameIntervals.over33ms, simulationTicks: row.simulationTicks,
        startTicks: row.startSimulationTicks, endTicks: row.endSimulationTicks, errors: row.errors,
        workerRequestP95Ms: row.workerRequestDelayMs?.length ? percentile(row.workerRequestDelayMs, 0.95) : null,
        paintingInputLatencyMs: row.paintingInputLatencyMs,
      })),
      mean: Object.fromEntries(metrics.map(([name, get]) => [name, mean(group.map(get))])),
    };
  }
}
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : null;
}
const overall = {};
for (const config of configs) {
  overall[config] = {};
  for (const [name] of metrics) overall[config][name] = mean(scenes.map(scene => byScene[scene][config].mean[name]));
}
const changesVsA = {};
for (const config of configs.slice(1)) {
  changesVsA[config] = {};
  for (const metric of ['simulationTps', 'uniqueWorldFrameFps', 'displayFps']) {
    const a = overall.A[metric], value = overall[config][metric];
    changesVsA[config][metric] = a === 0 ? null : (value / a - 1) * 100;
  }
  const baseP95 = overall.A.p95FrameMs, value = overall[config].p95FrameMs;
  changesVsA[config].p95FrameMsImprovement = baseP95 === 0 ? null : (1 - value / baseP95) * 100;
}
const summary = {
  generatedAt: new Date().toISOString(), input, expectedRows: 32, rowCount: rows.length,
  complete: true, matrix: '4 configurations x 4 scenes x 2 repetitions; 15 seconds measured after 5-second warmup.',
  scenes, configurationCommits: Object.fromEntries(configs.map(config => [config, rows.find(row => row.configuration === config).commit])),
  byScene, overall, changesVsA,
  caveats: [
    'Per-scene values are means of two runs; the overall values weight the four scenes equally.',
    'p95 is the mean of each run p95, not a percentile pooled from raw frame intervals.',
    'World-frame FPS counts world canvas image updates observed by the harness; display FPS counts requestAnimationFrame callbacks. Neither is a physical compositor scanout counter.',
    'Resource telemetry was disabled in this short run; per-application CPU/GPU/memory comparisons are unavailable.',
  ],
};
await writeFile(outputFile, `${JSON.stringify(summary, null, 2)}\n`);
for (const scene of scenes) {
  console.log(`\n${titles[scene]}`);
  console.log('| Config | Physics ticks/s | World frames/s | Display FPS | Mean run p95 (ms) |');
  console.log('|---|---:|---:|---:|---:|');
  for (const config of configs) {
    const m = byScene[scene][config].mean;
    console.log(`| ${config} | ${m.simulationTps.toFixed(1)} | ${m.uniqueWorldFrameFps.toFixed(1)} | ${m.displayFps.toFixed(1)} | ${m.p95FrameMs.toFixed(1)} |`);
  }
}
console.log(`\nSUMMARY ${outputFile}`);
