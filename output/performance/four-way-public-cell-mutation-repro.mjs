import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';

const base = 'C:/Users/angry/AppData/Local/Temp/mse-four-way-evaluation-20261008';
const variants = {};
for (const [id, dir] of [['A', 'A-baseline'], ['B', 'B-cpu']]) {
  const root = join(base, dir);
  const [{ Simulation }, { labConfig, M }] = await Promise.all([
    import(pathToFileURL(join(root, 'src/engine/simulation.ts')).href),
    import(pathToFileURL(join(root, 'src/demo/materials.ts')).href),
  ]);
  const width = 32, height = 32, sim = new Simulation(labConfig, width, height, 42);
  const startingIndex = 2 * width + 16;
  // This intentionally bypasses Simulation.set() to exercise the public Uint8Array API.
  sim.cells[startingIndex] = M.Sand;
  const positionsOfSand = () => {
    const positions = [];
    for (let index = 0; index < sim.cells.length; index++) if (sim.cells[index] === M.Sand) positions.push(index);
    return positions;
  };
  const trace = [positionsOfSand()];
  for (let tick = 0; tick < 8; tick++) { sim.step(); trace.push(positionsOfSand()); }
  variants[id] = { start: startingIndex, positions: trace.at(-1), trace, ticks: sim.ticks };
}
const firstDivergentTick = variants.A.trace.findIndex((positions, tick) => JSON.stringify(positions) !== JSON.stringify(variants.B.trace[tick]));
const result = {
  createdAt: new Date().toISOString(),
  scenario: 'Write one Sand cell directly into public Simulation.cells, then step eight ticks.',
  firstDivergentTick: firstDivergentTick < 0 ? null : firstDivergentTick,
  variants,
  equivalent: firstDivergentTick < 0,
};
const outputFile = 'output/performance/four-way-public-cell-mutation-repro-20261008.json';
await writeFile(outputFile, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
console.log(`Saved ${outputFile}`);
