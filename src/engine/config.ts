export type State = 'Empty' | 'Solid' | 'Liquid' | 'Gas' | 'Powder';
export type Transition = { output: string; counter?: string };
export type StressFailure = Transition & { compression: number; bending: number; interval: number; minCells: number; sectionRadius: number; limit: number; fraction: number };
export type MaterialDefinition = {
  key: string; name: string; state: State; density: number;
  thermal: { initialTemperature: number; capacity: number; conductivity: number; airTransfer: number; source?: boolean;
    flammability?: Transition; phaseChange?: Transition & { point: number; heat: number } };
  lifetime?: Transition & { min: number; range: number; spawnAbove?: { chance: number; output: string } };
  motion?: { pauseChance?: number; stepEvery?: number; diagonalFirstChance?: number };
  collision?: { hard: boolean };
  failure?: { impact?: Transition & { minRelativeSpeed: number }; stress?: StressFailure };
  displaceWhenTrapped?: boolean;
};
export type Selector = readonly string[] | { flammable: true };
export type ReactionRule = {
  inputs: { self: Selector; neighbor: Selector };
  conditions?: { minTemperature?: number; maxTemperature?: number; probability?: number };
  outputs: readonly { target: 'self' | 'neighbor' | 'empty-neighbor'; material: string | '$flammability' }[];
  counter?: string; stop?: boolean;
};
export type WorldConfig = { materials: readonly MaterialDefinition[]; reactions: readonly ReactionRule[]; counters?: readonly string[] };
export type CompiledRule = Omit<ReactionRule, 'inputs' | 'outputs'> & { outputs: readonly { target: 'self' | 'neighbor' | 'empty-neighbor'; material: number }[] };

/** Registry order assigns runtime IDs. Slot zero is the sole empty-space sentinel. */
export function compileConfig(input: WorldConfig) {
  const config = structuredClone(input);
  const materials = config.materials;
  if (!materials.length || materials.length > 256 || materials[0].state !== 'Empty' || materials.slice(1).some(m => m.state === 'Empty')) throw new Error('Config requires one empty material at slot zero and at most 256 materials');
  const ids = new Map<string, number>();
  const finite = (value: number, label: string, min = 0) => { if (!Number.isFinite(value) || value < min) throw new Error(`Invalid ${label}`); };
  const probability = (value: number | undefined) => { if (value !== undefined) { finite(value, 'probability'); if (value > 1) throw new Error('Invalid probability'); } };
  for (const [id, m] of materials.entries()) {
    if (!m.key || ids.has(m.key)) throw new Error(`Duplicate or empty material key: ${m.key}`);
    ids.set(m.key, id);
    if (!['Empty', 'Solid', 'Liquid', 'Gas', 'Powder'].includes(m.state)) throw new Error('Invalid material state');
    finite(m.density, 'density', id ? Number.MIN_VALUE : 0);
    if (!id && m.density !== 0) throw new Error('Empty-space density must be zero');
    finite(m.thermal.initialTemperature, 'temperature', -Infinity);
    finite(m.thermal.capacity, 'capacity', Number.MIN_VALUE); finite(m.thermal.conductivity, 'conductivity'); finite(m.thermal.airTransfer, 'air transfer');
    if (m.thermal.phaseChange) { finite(m.thermal.phaseChange.point, 'phase point', -Infinity); finite(m.thermal.phaseChange.heat, 'phase heat', Number.MIN_VALUE); }
    if (m.lifetime) { for (const v of [m.lifetime.min, m.lifetime.range]) if (!Number.isInteger(v) || v < 0) throw new Error('Invalid lifetime'); if (m.lifetime.min + m.lifetime.range > 65535) throw new Error('Lifetime exceeds storage'); probability(m.lifetime.spawnAbove?.chance); }
    probability(m.motion?.pauseChance); probability(m.motion?.diagonalFirstChance);
    if (m.motion?.stepEvery !== undefined && (!Number.isInteger(m.motion.stepEvery) || m.motion.stepEvery < 1)) throw new Error('Invalid motion interval');
    if (m.failure?.impact) finite(m.failure.impact.minRelativeSpeed, 'impact threshold');
    const stress = m.failure?.stress;
    if (stress) { for (const v of [stress.compression, stress.bending, stress.fraction]) finite(v, 'strength', Number.MIN_VALUE); for (const v of [stress.interval, stress.minCells, stress.sectionRadius, stress.limit]) if (!Number.isInteger(v) || v < 1) throw new Error('Invalid stress limits'); }
  }
  const materialId = (key: string) => { const id = ids.get(key); if (id === undefined) throw new Error(`Unknown material: ${key}`); return id; };
  const counters = new Set(config.counters);
  for (const m of materials) for (const t of [m.thermal.flammability, m.thermal.phaseChange, m.lifetime, m.failure?.impact, m.failure?.stress]) if (t) { materialId(t.output); if (t.counter) counters.add(t.counter); }
  for (const m of materials) if (m.lifetime?.spawnAbove) materialId(m.lifetime.spawnAbove.output);
  const matches = (selector: Selector) => {
    if (Array.isArray(selector)) return selector.map(materialId);
    if (!selector || !('flammable' in selector) || selector.flammable !== true) throw new Error('Invalid reaction selector');
    return materials.flatMap((m, id) => m.thermal.flammability ? [id] : []);
  };
  const rules: CompiledRule[][][] = materials.map(() => materials.map(() => []));
  for (const rule of config.reactions) {
    probability(rule.conditions?.probability);
    for (const value of [rule.conditions?.minTemperature, rule.conditions?.maxTemperature]) if (value !== undefined) finite(value, 'reaction temperature', -Infinity);
    if (rule.conditions?.minTemperature !== undefined && rule.conditions?.maxTemperature !== undefined && rule.conditions.minTemperature > rule.conditions.maxTemperature) throw new Error('Invalid reaction temperature range');
    for (const output of rule.outputs) {
      if (!['self', 'neighbor', 'empty-neighbor'].includes(output.target)) throw new Error('Invalid reaction output target');
      if (output.material !== '$flammability') materialId(output.material);
    }
    if (rule.counter) counters.add(rule.counter);
    for (const self of matches(rule.inputs.self)) for (const neighbor of matches(rule.inputs.neighbor)) {
      const outputs = rule.outputs.map(o => {
        const key = o.material === '$flammability' ? materials[neighbor].thermal.flammability?.output : o.material;
        if (!key) throw new Error('Flammability output requires a flammable neighbor');
        return { target: o.target, material: materialId(key) };
      });
      rules[self][neighbor].push({ ...rule, outputs });
    }
  }
  const actors = rules.map(neighbors => neighbors.some(list => list.length));
  // A caller can reuse or edit its source data without changing a running world.
  const freeze = (value: unknown): void => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } };
  freeze(materials); freeze(rules); freeze(actors);
  return { materials, rules, actors, materialId, counters: Object.fromEntries([...counters].map(c => [c, 0])) as Record<string, number> };
}
