import type { StressFailure } from './config';

// Route weight along shortest paths to supporting cells. Shared paths split
// load; narrow connections collect it. Horizontal lever arms add bending stress.
export function stressFailures(cells: number[], width: number, supports: number[], density: number, loadRatio: number, strength: StressFailure, gravity: number) {
  if (!supports.length) return [];
  const ids = new Map<number, number>(); cells.forEach((cell, id) => ids.set(cell, id));
  const distance = new Int32Array(cells.length); distance.fill(-1);
  const weight = new Float64Array(cells.length), moment = new Float64Array(cells.length), queue: number[] = [];
  const neighbors = (cell: number) => [cell % width ? cell - 1 : -1, cell % width + 1 < width ? cell + 1 : -1, cell - width, cell + width];
  for (const cell of supports) { const id = ids.get(cell)!; if (distance[id] < 0) { distance[id] = 0; queue.push(id); } }
  for (let q = 0; q < queue.length; q++) for (const cell of neighbors(cells[queue[q]])) {
    const id = ids.get(cell); if (id !== undefined && distance[id] < 0) { distance[id] = distance[queue[q]] + 1; queue.push(id); }
  }
  const unitMass = density / 1000 * loadRatio;
  for (let i = 0; i < cells.length; i++) { weight[i] = unitMass; moment[i] = unitMass * (cells[i] % width); }
  const failures: { cell: number; stress: number }[] = [];
  for (let q = queue.length - 1; q >= 0; q--) {
    const id = queue[q], cell = cells[id];
    let horizontal = 1, vertical = 1;
    for (const direction of [-1, 1]) {
      for (let r = 1; r <= strength.sectionRadius && (cell % width) + direction * r >= 0 && (cell % width) + direction * r < width && ids.has(cell + direction * r); r++) horizontal++;
      for (let r = 1; r <= strength.sectionRadius && ids.has(cell + direction * r * width); r++) vertical++;
    }
    const section = Math.min(horizontal, vertical);
    const stress = weight[id] * gravity / strength.compression
      + Math.abs(moment[id] - weight[id] * (cell % width)) * gravity / (strength.bending * section * section);
    if (stress > 1) failures.push({ cell, stress });
    const parents = neighbors(cell).map(n => ids.get(n)).filter((p): p is number => p !== undefined && distance[p] === distance[id] - 1);
    for (const p of parents) { weight[p] += weight[id] / parents.length; moment[p] += moment[id] / parents.length; }
  }
  failures.sort((a, b) => b.stress - a.stress || a.cell - b.cell);
  return failures.slice(0, Math.min(strength.limit, Math.ceil(cells.length * strength.fraction))).map(f => f.cell);
}
