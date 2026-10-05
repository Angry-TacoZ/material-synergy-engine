import test from 'node:test';
import assert from 'node:assert/strict';
import { panBy, screenToWorld, zoomAt } from '../src/demo/viewport.ts';

test('zoom keeps the material below an interior cursor in place', () => {
  const canvas = { width: 960, height: 576 }, pointer = { x: 620, y: 380 };
  const initial = { zoom: 1, scrollX: 0, scrollY: 0 };
  const before = screenToWorld(pointer, initial, canvas.width, canvas.height);
  const after = zoomAt(initial, pointer, -120, canvas.width, canvas.height);
  const mapped = screenToWorld(pointer, after, canvas.width, canvas.height);
  assert.ok(after.zoom > 1); assert.ok(after.zoom < 2);
  assert.ok(Math.abs(before.x - mapped.x) < 1e-9);
  assert.ok(Math.abs(before.y - mapped.y) < 1e-9);
});

test('zoom respects scene edges and resets exactly to the full view', () => {
  const width = 960, height = 576;
  let view = { zoom: 1, scrollX: 0, scrollY: 0 };
  for (let i = 0; i < 100; i++) view = zoomAt(view, { x: 0, y: 0 }, -120, width, height);
  assert.equal(view.zoom, 8);
  assert.ok(screenToWorld({ x: 0, y: 0 }, view, width, height).x >= 0);
  assert.ok(screenToWorld({ x: 0, y: 0 }, view, width, height).y >= 0);
  for (let i = 0; i < 100; i++) view = zoomAt(view, { x: width, y: height }, 120, width, height);
  assert.deepEqual(view, { zoom: 1, scrollX: 0, scrollY: 0 });
});

test('dragging a zoomed view moves the world with the finger and stays in bounds', () => {
  const width = 960, height = 576;
  const view = zoomAt({ zoom: 1, scrollX: 0, scrollY: 0 }, { x: 480, y: 288 }, -462, width, height);
  const point = { x: 480, y: 288 }, before = screenToWorld(point, view, width, height);
  const moved = panBy(view, { x: 80, y: -40 }, width, height);
  const after = screenToWorld({ x: point.x + 80, y: point.y - 40 }, moved, width, height);
  assert.ok(Math.abs(before.x - after.x) < 1e-9);
  assert.ok(Math.abs(before.y - after.y) < 1e-9);
  const edge = panBy(moved, { x: 100000, y: -100000 }, width, height);
  assert.ok(screenToWorld({ x: 0, y: height }, edge, width, height).x >= -1e-9);
  assert.ok(screenToWorld({ x: 0, y: height }, edge, width, height).y <= height + 1e-9);
});
