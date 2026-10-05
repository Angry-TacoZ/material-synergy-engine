export type Viewport = { zoom: number; scrollX: number; scrollY: number };
export type Point = { x: number; y: number };

/** Phaser's unrotated camera centers its zoom on the middle of the canvas. */
export function screenToWorld(point: Point, view: Viewport, width: number, height: number): Point {
  return {
    x: width / 2 + view.scrollX + (point.x - width / 2) / view.zoom,
    y: height / 2 + view.scrollY + (point.y - height / 2) / view.zoom,
  };
}

export function zoomAt(view: Viewport, point: Point, deltaY: number, width: number, height: number): Viewport {
  const zoom = Math.max(1, Math.min(8, view.zoom * Math.exp(-deltaY * .0015)));
  const limitX = width / 2 * (1 - 1 / zoom), limitY = height / 2 * (1 - 1 / zoom);
  const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
  return {
    zoom,
    scrollX: clamp(view.scrollX + (point.x - width / 2) * (1 / view.zoom - 1 / zoom), limitX),
    scrollY: clamp(view.scrollY + (point.y - height / 2) * (1 / view.zoom - 1 / zoom), limitY),
  };
}

/** A drag moves the visible world with the finger, clamped to the scene edges. */
export function panBy(view: Viewport, delta: Point, width: number, height: number): Viewport {
  const limitX = width / 2 * (1 - 1 / view.zoom), limitY = height / 2 * (1 - 1 / view.zoom);
  const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
  return {
    zoom: view.zoom,
    scrollX: clamp(view.scrollX - delta.x / view.zoom, limitX),
    scrollY: clamp(view.scrollY - delta.y / view.zoom, limitY),
  };
}
