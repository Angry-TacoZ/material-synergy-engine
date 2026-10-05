import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { Simulation, M } from '../src/simulation.ts';

// Execute the registered UI handler rather than duplicating its tool-mode logic.
const source = ts.createSourceFile('main.ts', readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
let callback: ts.Expression | undefined;
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'document.addEventListener'
    && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'keydown') callback = node.arguments[1];
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(callback, 'the UI must register its keyboard handler');
const script = ts.transpileModule(`globalThis.handle = ${callback.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function keyboard(sim: Simulation, erasing: boolean, panning: boolean) {
  const game = {}, context = {
    sim, erasing, panning, selected: M.Sand, cursor: { x: 40, y: 40 }, brush: 16,
    document: { activeElement: game }, el: () => game,
    HTMLInputElement: class {}, HTMLSelectElement: class {}, HTMLButtonElement: class {},
    handle: undefined as undefined | ((event: unknown) => void),
  };
  runInNewContext(script, context);
  context.handle!({ key: 'Enter', code: 'Enter', target: game, preventDefault() {} });
}

for (const erasing of [false, true]) test(`${erasing ? 'Erase' : 'Paint'} → Pan → Enter preserves the experiment`, () => {
  const sim = new Simulation(80, 80);
  if (erasing) sim.paint(40, 40, 16, M.Sand);
  const before = sim.cells.slice(), revision = sim.revision;
  keyboard(sim, erasing, true);
  assert.deepEqual(sim.cells, before);
  assert.equal(sim.revision, revision);
});

test('Enter still paints and erases when those tools are selected', () => {
  const sim = new Simulation(80, 80);
  keyboard(sim, false, false);
  assert.equal(sim.counts().Sand, 797);
  keyboard(sim, true, false);
  assert.deepEqual(sim.counts(), {});
});
