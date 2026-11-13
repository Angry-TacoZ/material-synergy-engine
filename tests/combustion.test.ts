import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation as Engine, type WorldConfig } from '../src/engine/index.ts';
import { Simulation, M } from '../src/simulation.ts';
import { labConfig } from '../src/demo/materials.ts';
const steps = (s: Engine, count: number) => { for (let i = 0; i < count; i++) s.step(); };
function isolated(key = 'wood', temperature = 880) {
  const config: WorldConfig = structuredClone(labConfig);
  const m = config.materials.find(m => m.key === key)!;
  m.thermal = { ...m.thermal, initialTemperature: temperature, conductivity: 0, airTransfer: 0 };
  return { config, m };
}

test('combustion waits for sustained temperature, resets exposure, and retains material identity', () => {
  const { config, m } = isolated(); m.combustion!.exposureTicks = 6;
  const s = new Engine(config, 32, 20), i = 19 * 32 + 16; s.set(16, 19, M.Wood);
  steps(s, 5); assert.equal(s.burning[i], 0); assert.equal(s.fuel[i], 1);
  s.temperature[i] = m.combustion!.ignitionPoint - 1; s.step();
  s.temperature[i] = 880; steps(s, 5); assert.equal(s.burning[i], 0);
  s.step(); assert.ok(s.burning[i] > 0); assert.equal(s.getCell(i), M.Wood); assert.equal(s.reactions.ignition, 1);
});

test('fuel consumption is gradual, lowers connected mass, and charring survives extinguishing', () => {
  const { config } = isolated(); const s = new Engine(config, 32, 20), i = 19 * 32 + 16;
  s.set(16, 19, M.Wood); const mass = s.bodyAt(16, 19)!.mass;
  steps(s, 300); assert.equal(s.getCell(i), M.Wood); assert.ok(s.fuel[i] < .95 && s.fuel[i] > .7);
  assert.ok(s.bodyAt(16, 19)!.mass < mass);
  const fuel = s.fuel[i]; s.temperature[i] = 0; s.step();
  assert.equal(s.burning[i], 0); assert.equal(s.fuel[i], fuel);
});

test('wood, grass and oil have distinct consumption times and oil leaves no solid ash', () => {
  const durations: Record<string, number> = {};
  for (const key of ['wood', 'grass', 'oil']) {
    const { config, m } = isolated(key, 1100); m.motion = { pauseChance: 1 }; m.combustion!.residueChance = 1;
    const s = new Engine(config, 32, 40), id = s.materialId(key); s.set(16, 39, id);
    for (let t = 1; t <= 8000; t++) { s.step(); if (!s.counts()[m.name]) { durations[key] = t; break; } }
    assert.ok(durations[key], `${key} eventually exhausts its finite fuel`);
    assert.equal(s.counts().Ash ?? 0, key === 'oil' ? 0 : 1);
  }
  assert.ok(durations.grass < durations.oil && durations.oil < durations.wood, JSON.stringify(durations));
  assert.ok(durations.wood > 600, 'even exposed preheated wood lasts longer than ten seconds');
});

for (const water of [M.Water, M.Saltwater]) test(`material ${water} quenches burning fuel without deleting it`, () => {
  const { config } = isolated(); config.materials[water].motion = { pauseChance: 1 };
  const s = new Engine(config, 32, 20), i = 19 * 32 + 16;
  s.set(16, 19, M.Wood); steps(s, 120); assert.ok(s.burning[i]); const fuel = s.fuel[i];
  s.set(15, 19, water); s.step(); assert.equal(s.burning[i], 0); assert.equal(s.getCell(i), M.Wood); assert.equal(s.fuel[i], fuel);
  assert.ok(s.temperature[i] < 180);
  s.set(15, 19, M.Empty); s.temperature[i] = 880; steps(s, 89); assert.equal(s.burning[i], 0);
  s.step(); assert.ok(s.burning[i], 'dried fuel must complete ignition exposure again');
});

test('flames expire independently of ash and fuel emits smoke before exhaustion', () => {
  const s = new Simulation(64, 128); s.set(32, 110, M.Fire); steps(s, 65);
  assert.equal(s.counts().Fire ?? 0, 0); assert.equal(s.counts().Ash ?? 0, 0);
  const { config } = isolated(); const burning = new Engine(config, 64, 128); burning.set(32, 127, M.Wood);
  let smoke = false, flame = false;
  for (let t = 0; t < 500; t++) { burning.step(); smoke ||= !!burning.counts().Smoke; flame ||= !!burning.counts().Fire; }
  assert.ok(smoke && flame); assert.equal(burning.counts().Wood, 1); assert.equal(burning.counts().Ash ?? 0, 0);
  assert.ok(burning.emissionSource.some(id => id === M.Wood));
});

test('localized heat propagates progressively without direct fuel replacement', () => {
  const s = new Simulation(48, 32); s.set(20, 31, M.Lava);
  for (let x = 21; x <= 25; x++) s.set(x, 31, M.Wood);
  steps(s, 60); assert.equal(s.reactions.ignition, 0);
  steps(s, 540); assert.ok(s.reactions.ignition >= 2); assert.equal(s.counts().Wood, 5);
  assert.ok(s.fuel.some((fuel, i) => s.getCell(i) === M.Wood && fuel < .99));
});

test('consuming a supporting connection releases a branch through the existing solid solver', () => {
  const { config, m } = isolated('wood', 0);
  m.combustion = { ...m.combustion!, exposureTicks: 3, burnRate: .04, residueChance: 1, flameChance: 0, smokeChance: 0 };
  const s = new Engine(config, 32, 32);
  for (let y = 10; y < 32; y++) s.set(8, y, M.Wood);
  for (let x = 8; x <= 20; x++) s.set(x, 10, M.Wood);
  const cutUV = s.surfaceUV[10 * 32 + 12], branchUV = s.surfaceUV[10 * 32 + 18];
  s.temperature[10 * 32 + 12] = 880;
  steps(s, 4); assert.equal(s.counts().Wood, 34, 'initial ignition does not sever the branch');
  steps(s, 250);
  assert.ok((s.counts().Ash ?? 0) >= 1);
  const branch = Array.from(s.cells).findIndex((id, i) => id === M.Wood && s.surfaceUV[i] === branchUV);
  assert.ok(branch >= 0 && Math.floor(branch / 32) > 12, 'unsupported branch falls');
  assert.ok(!Array.from(s.cells).some((id, i) => id === M.Wood && s.surfaceUV[i] === cutUV));
});

test('fuel, charring and emission provenance travel with rotating solids and flowing oil', () => {
  for (const type of [M.Wood, M.Oil]) {
    const s = new Simulation(48, 48); s.set(20, 10, type); s.set(21, 10, type); s.set(20, 11, type);
    const i = 10 * 48 + 21, uv = s.surfaceUV[i]; s.fuel[i] *= .6; const fuel = s.fuel[i];
    steps(s, 120);
    const dest = Array.from(s.cells).findIndex((id, n) => id === type && s.surfaceUV[n] === uv);
    assert.ok(dest >= 0); assert.equal(s.fuel[dest], fuel); assert.equal(s.burning[dest], 0);
  }
});

test('burning tree retains wood after ten seconds and replays all combustion state', () => {
  const a = new Simulation(), b = new Simulation();
  for (const s of [a, b]) s.load('burn-tree');
  const wood = a.counts().Wood;
  steps(a, 600); steps(b, 600);
  assert.equal(a.counts().Wood, wood); assert.ok(a.reactions.ignition > 0); assert.ok(a.counts().Ash > 0);
  assert.ok(a.fuel.some((fuel, i) => a.getCell(i) === M.Wood && fuel < .95));
  for (const property of ['fuel', 'burning', 'emissionSource', 'temperature', 'life'] as const) assert.deepEqual(a[property], b[property]);
  assert.deepEqual(a.copyCells(), b.copyCells()); assert.deepEqual(a.reactions, b.reactions); assert.equal(a.random(), b.random());
  a.clear(); assert.ok(a.fuel.every(v => v === 0)); assert.ok(a.burning.every(v => v === 0)); assert.ok(a.emissionSource.every(v => v === 0));
});

test('combustion validates parameters, references and conflicting replacement paths', () => {
  for (const edit of [
    (m: any) => m.combustion.burnRate = -1,
    (m: any) => m.combustion.exposureTicks = 1.5,
    (m: any) => m.combustion.flame = 'absent',
    (m: any) => m.combustion.flame = 'stone',
    (m: any) => m.combustion.extinctionPoint = 9999,
    (m: any) => m.combustion.remainingMass = 0,
    (m: any) => m.thermal.flammability = { output: 'fire' },
  ]) {
    const { config, m } = isolated(); edit(m); assert.throws(() => new Engine(config));
  }
});
