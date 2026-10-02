import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, M } from '../src/simulation.ts';
import { MaterialRenderer } from '../src/rendering.ts';

test('grass burns and concrete remains nonflammable', () => {
  for (const type of [M.Grass, M.Concrete]) {
    const s = new Simulation(20, 20); s.set(10, 19, M.Lava); s.set(11, 19, type); s.step();
    assert.equal(s.cells[19 * 20 + 11], type === M.Grass ? M.Fire : M.Concrete);
  }
});
test('acid erodes grass and concrete', () => {
  for (const type of [M.Grass, M.Concrete]) {
    const s = new Simulation(20, 20); s.set(10, 19, M.Acid); s.set(11, 19, type); s.step();
    assert.equal(s.reactions.erosion, 1); assert.equal(s.counts()[type === M.Grass ? 'Grass' : 'Concrete'], undefined);
  }
});
test('new materials have mass, connected gravity, and distinct rendered textures', () => {
  const s = new Simulation(32, 32); s.set(10, 5, M.Concrete); s.set(11, 5, M.Concrete); s.set(20, 5, M.Grass); s.set(21, 5, M.Grass);
  for (let i = 0; i < 6; i++) s.step();
  assert.equal(s.bodyAt(10, 6)!.mass, 4.8); assert.equal(s.bodyAt(20, 6)!.mass, .9);
  const image = { data: new Uint8ClampedArray(32 * 32 * 4) } as ImageData; new MaterialRenderer(32, 32).render(image, s);
  const concrete = (6 * 32 + 10) * 4, grass = (6 * 32 + 20) * 4;
  assert.ok(image.data[concrete] > 50); assert.ok(image.data[grass + 1] > image.data[grass]);
});
