import { Simulation, M } from './simulation';
import { MaterialRenderer } from './rendering';
import type { ParticleInspection, ParticleWorkerCommand, ParticleWorkerMessage } from './particle-worker-protocol';

const WIDTH = 960, HEIGHT = 576, TICK_MS = 1000 / 60;
const scope = self as unknown as {
  addEventListener(type: 'message', callback: (event: MessageEvent<ParticleWorkerCommand>) => void): void;
  postMessage(message: ParticleWorkerMessage, transfer?: Transferable[]): void;
};
const sim = new Simulation(WIDTH, HEIGHT);
const renderer = new MaterialRenderer(WIDTH, HEIGHT);
const surface = new OffscreenCanvas(WIDTH, HEIGHT);
const context = surface.getContext('2d');
if (!context) throw new Error('OffscreenCanvas 2D rendering is unavailable.');
const drawingContext = context as OffscreenCanvasRenderingContext2D;
const image = drawingContext.createImageData(WIDTH, HEIGHT);
const vaporSurface = new OffscreenCanvas(WIDTH, HEIGHT);
const vaporContext = vaporSurface.getContext('2d');
if (!vaporContext) throw new Error('OffscreenCanvas vapor rendering is unavailable.');
const vaporDrawingContext = vaporContext as OffscreenCanvasRenderingContext2D;
const vapor = vaporDrawingContext.createImageData(WIDTH, HEIGHT);

let paused = false, speed = 1, accumulator = 0, lastFrame = performance.now(), initialized = false;
let renderInFlight = false, renderedTick = -1, renderedRevision = -1;
let cursor = { x: 120, y: 50 };

function render() {
  if (renderInFlight) return;
  const cells = renderer.render(image, sim);
  vapor.data.fill(0);
  let hasVapor = false;
  for (let i = 0; i < cells.length; i++) {
    const type = cells[i];
    if (type !== M.Steam && type !== M.Smoke) continue;
    hasVapor = true;
    const smoke = type === M.Smoke;
    vapor.data[i * 4] = smoke ? 87 : 235;
    vapor.data[i * 4 + 1] = smoke ? 97 : 244;
    vapor.data[i * 4 + 2] = smoke ? 112 : 250;
    vapor.data[i * 4 + 3] = (smoke ? 130 : 170) * Math.min(1, sim.life[i] / (smoke ? 100 : 180));
  }
  drawingContext.putImageData(image, 0, 0);
  if (hasVapor) {
    vaporDrawingContext.putImageData(vapor, 0, 0);
    drawingContext.save();
    drawingContext.filter = 'blur(10px)'; drawingContext.globalAlpha = .55; drawingContext.drawImage(vaporSurface, 0, 0);
    drawingContext.filter = 'blur(4px)'; drawingContext.globalAlpha = .8; drawingContext.drawImage(vaporSurface, 0, 0);
    drawingContext.restore();
  }
  renderedTick = sim.ticks; renderedRevision = sim.revision;
  renderInFlight = true;
  const ticks = sim.ticks, revision = sim.revision, material = cells[cursor.y * WIDTH + cursor.x];
  void createImageBitmap(surface).then(bitmap => {
    scope.postMessage({ type: 'frame', bitmap, ticks, revision, material }, [bitmap]);
  }).catch(error => {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }).finally(() => { renderInFlight = false; });
}

function inspection(x: number, y: number): ParticleInspection {
  return {
    ticks: sim.ticks,
    counts: sim.counts(),
    reactions: { ...sim.reactions },
    bodies: sim.bodySummaries(),
    body: sim.bodyAt(x, y),
    temperature: sim.temperatureAt(x, y),
    material: sim.cells[y * WIDTH + x],
  };
}

function acknowledge(id: number) { scope.postMessage({ type: 'ack', id }); }

scope.addEventListener('message', event => {
  const command = event.data;
  try {
    switch (command.type) {
      case 'input':
        if (command.strokes.length) initialized = true;
        for (const stroke of command.strokes) {
          for (const point of stroke.points) sim.paint(point.x, point.y, stroke.radius, stroke.material);
        }
        if (command.cursor) {
          cursor = command.cursor;
          scope.postMessage({ type: 'cursor', material: sim.cells[cursor.y * WIDTH + cursor.x] });
        }
        acknowledge(command.id);
        break;
      case 'scene':
        initialized = true;
        sim.load(command.preset);
        render(); acknowledge(command.id);
        break;
      case 'clear':
        initialized = true;
        sim.clear(); render(); acknowledge(command.id);
        break;
      case 'pause':
        paused = command.paused;
        if (paused) accumulator = 0;
        acknowledge(command.id);
        break;
      case 'speed':
        speed = command.speed;
        acknowledge(command.id);
        break;
      case 'step':
        initialized = true;
        sim.step(); render(); acknowledge(command.id);
        break;
      case 'advance':
        initialized = true;
        if (!paused) for (let i = 0; i < Math.round(command.milliseconds / TICK_MS * speed); i++) sim.step();
        render(); acknowledge(command.id);
        break;
      case 'inspect':
        scope.postMessage({ type: 'inspection', id: command.id, value: inspection(command.x, command.y) });
        break;
    }
  } catch (error) {
    scope.postMessage({ type: 'error', id: 'id' in command ? command.id : undefined, message: error instanceof Error ? error.message : String(error) });
  }
});

function update(now: number) {
  if (!initialized) {
    setTimeout(() => update(performance.now()), 16);
    return;
  }
  const delta = Math.min(now - lastFrame, 50);
  lastFrame = now;
  if (!paused) {
    accumulator += delta * speed;
    let steps = 0;
    while (accumulator >= TICK_MS && steps < 4) { sim.step(); accumulator -= TICK_MS; steps++; }
    accumulator = Math.min(accumulator, TICK_MS * 2);
  }
  if ((renderedTick !== sim.ticks || renderedRevision !== sim.revision) && !renderInFlight) render();
  setTimeout(() => update(performance.now()), paused ? 16 : 4);
}

scope.postMessage({ type: 'ready' });
setTimeout(() => update(performance.now()), 0);
