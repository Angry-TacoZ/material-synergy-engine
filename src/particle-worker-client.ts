import type {
  ParticleInspection,
  ParticleWorkerCommand,
  ParticleWorkerInput,
  ParticleWorkerMessage,
  ParticleWorkerPaintStroke,
  ParticleWorkerPoint,
} from './particle-worker-protocol';

export type ParticleWorkerState = 'starting' | 'ready' | 'failed' | 'disposed';

export interface ParticleWorkerTransport {
  postMessage(message: ParticleWorkerCommand): void;
  onMessage(handler: (message: ParticleWorkerMessage) => void): void;
  onError(handler: (error: Error) => void): void;
  onMessageError(handler: (error: Error) => void): void;
  terminate(): void;
}

export type ParticleWorkerClientOptions = {
  createWorker?: () => ParticleWorkerTransport;
  readyTimeoutMs?: number;
  operationTimeoutMs?: number;
  maxQueuedPaintPoints?: number;
  maxQueuedOperations?: number;
};

type ExpectedResponse = 'ack' | 'inspection';

type QueuedOperation = {
  id: number;
  command: ParticleWorkerCommand;
  expectedResponse: ExpectedResponse;
  paintPointCount: number;
  resolve: (value: ParticleInspection | void) => void;
  reject: (error: Error) => void;
};

const READY_TIMEOUT_MS = 10_000;
const OPERATION_TIMEOUT_MS = 10_000;
const MAX_QUEUED_PAINT_POINTS = 65_536;
const MAX_QUEUED_OPERATIONS = 128;

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

function mergeStrokes(target: ParticleWorkerPaintStroke[], incoming: ParticleWorkerPaintStroke[]) {
  for (const stroke of incoming) {
    const last = target[target.length - 1];
    if (last && last.radius === stroke.radius && last.material === stroke.material) {
      for (const point of stroke.points) last.points.push(point);
    } else {
      target.push(stroke);
    }
  }
}

function createBrowserTransport(): ParticleWorkerTransport {
  const worker = new Worker(new URL('./particle.worker.ts', import.meta.url), { type: 'module' });
  return {
    postMessage: message => worker.postMessage(message),
    onMessage: handler => worker.addEventListener('message', event => handler(event.data as ParticleWorkerMessage)),
    onError: handler => worker.addEventListener('error', event => handler(new Error(event.message || 'Particle worker failed.'))),
    onMessageError: handler => worker.addEventListener('messageerror', () => handler(new Error('Particle worker sent an unreadable message.'))),
    terminate: () => worker.terminate(),
  };
}

export class ParticleWorkerClient {
  readonly width = 960;
  readonly height = 576;
  private worker: ParticleWorkerTransport | null = null;
  private stateValue: ParticleWorkerState = 'starting';
  private failure: Error | null = null;
  private failureHandler: ((error: Error) => void) | null = null;
  private failureReported = false;
  private nextId = 1;
  private queue: QueuedOperation[] = [];
  private inFlight: QueuedOperation | null = null;
  private pendingStrokes: ParticleWorkerPaintStroke[] = [];
  private pendingCursor: ParticleWorkerPoint | undefined;
  private queuedPaintPoints = 0;
  private inputFlushScheduled = false;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private operationTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly readyTimeoutMs: number;
  private readonly operationTimeoutMs: number;
  private readonly maxQueuedPaintPoints: number;
  private readonly maxQueuedOperations: number;

  frame: ImageBitmap | null = null;
  frameVersion = 0;
  ticks = 0;
  revision = 0;
  hoveredMaterial = 0;

  constructor(options: ParticleWorkerClientOptions = {}) {
    this.readyTimeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS;
    this.operationTimeoutMs = options.operationTimeoutMs ?? OPERATION_TIMEOUT_MS;
    this.maxQueuedPaintPoints = options.maxQueuedPaintPoints ?? MAX_QUEUED_PAINT_POINTS;
    this.maxQueuedOperations = options.maxQueuedOperations ?? MAX_QUEUED_OPERATIONS;

    try {
      this.worker = (options.createWorker ?? createBrowserTransport)();
      this.worker.onMessage(message => this.receive(message));
      this.worker.onError(error => this.fail(error));
      this.worker.onMessageError(error => this.fail(error));
      this.readyTimer = setTimeout(() => this.fail(new Error('Particle worker did not become ready in time.')), this.readyTimeoutMs);
    } catch (error) {
      this.fail(asError(error));
    }
  }

  get state() { return this.stateValue; }

  setFailureHandler(handler: (error: Error) => void) {
    this.failureHandler = handler;
    this.reportFailure();
  }

  private reportFailure() {
    if (this.stateValue !== 'failed' || !this.failure || !this.failureHandler || this.failureReported) return;
    this.failureReported = true;
    this.failureHandler(this.failure);
  }

  private clearTimers() {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    if (this.operationTimer) clearTimeout(this.operationTimer);
    this.readyTimer = null;
    this.operationTimer = null;
  }

  /** Worker failure is terminal: stop transport, reject queued work, and keep the last displayed frame; there is no silent main-thread fallback. */
  private fail(error: Error) {
    if (this.stateValue === 'failed' || this.stateValue === 'disposed') return;
    this.stateValue = 'failed';
    this.failure = error;
    this.clearTimers();
    this.worker?.terminate();
    this.worker = null;

    const outstanding = [...(this.inFlight ? [this.inFlight] : []), ...this.queue];
    this.inFlight = null;
    this.queue = [];
    this.pendingStrokes = [];
    this.pendingCursor = undefined;
    this.queuedPaintPoints = 0;
    for (const operation of outstanding) operation.reject(error);
    this.reportFailure();
  }

  private receive(message: ParticleWorkerMessage) {
    if (this.stateValue === 'failed' || this.stateValue === 'disposed') {
      if (message.type === 'frame') message.bitmap.close();
      return;
    }

    if (message.type === 'ready') {
      if (this.stateValue !== 'starting') {
        this.fail(new Error('Particle worker sent an unexpected ready message.'));
        return;
      }
      this.stateValue = 'ready';
      if (this.readyTimer) clearTimeout(this.readyTimer);
      this.readyTimer = null;
      this.dispatchNext();
      return;
    }

    if (this.stateValue !== 'ready') {
      if (message.type === 'frame') message.bitmap.close();
      this.fail(new Error('Particle worker sent a message before becoming ready.'));
      return;
    }

    if (message.type === 'frame') {
      this.frame?.close();
      this.frame = message.bitmap;
      this.frameVersion++;
      this.ticks = message.ticks;
      this.revision = message.revision;
      this.hoveredMaterial = message.material;
    } else if (message.type === 'cursor') {
      this.hoveredMaterial = message.material;
    } else if (message.type === 'ack' || message.type === 'inspection') {
      this.complete(message);
    } else if (message.type === 'error') {
      if (message.id !== undefined && this.inFlight?.id !== message.id) {
        this.fail(new Error('Particle worker error response did not match the in-flight operation.'));
      } else {
        this.fail(new Error(message.message || 'Particle worker failed.'));
      }
    }
  }

  private complete(message: Extract<ParticleWorkerMessage, { type: 'ack' | 'inspection' }>) {
    const operation = this.inFlight;
    if (!operation || operation.id !== message.id) {
      this.fail(new Error('Particle worker response did not match the in-flight operation.'));
      return;
    }
    if (operation.expectedResponse !== message.type) {
      this.fail(new Error(`Particle worker returned ${message.type} for an operation expecting ${operation.expectedResponse}.`));
      return;
    }

    if (this.operationTimer) clearTimeout(this.operationTimer);
    this.operationTimer = null;
    this.inFlight = null;
    this.queuedPaintPoints -= operation.paintPointCount;
    operation.resolve(message.type === 'inspection' ? message.value : undefined);
    this.dispatchNext();
  }

  private dispatchNext() {
    if (this.stateValue !== 'ready' || this.inFlight || this.queue.length === 0) return;
    const operation = this.queue.shift()!;
    this.inFlight = operation;
    this.operationTimer = setTimeout(() => {
      this.fail(new Error(`Particle worker did not acknowledge ${operation.command.type} in time.`));
    }, this.operationTimeoutMs);
    try {
      if (!this.worker) throw new Error('Particle worker is unavailable.');
      this.worker.postMessage(operation.command);
    } catch (error) {
      this.fail(asError(error));
    }
  }

  private enqueue<T extends ParticleInspection | void>(
    createCommand: (id: number) => ParticleWorkerCommand,
    expectedResponse: ExpectedResponse = 'ack',
  ): Promise<T> {
    this.flushPendingInput();
    return new Promise<T>((resolve, reject) => {
      if (this.stateValue === 'failed' || this.stateValue === 'disposed') {
        reject(this.failure ?? new Error('Particle worker is unavailable.'));
        return;
      }
      if (this.queue.length + (this.inFlight ? 1 : 0) >= this.maxQueuedOperations) {
        const error = new Error('Particle worker command queue exceeded its safe limit; the simulation has stopped.');
        this.fail(error);
        reject(error);
        return;
      }

      const id = this.nextId++;
      this.queue.push({
        id,
        command: createCommand(id),
        expectedResponse,
        paintPointCount: 0,
        resolve: value => resolve(value as T),
        reject,
      });
      this.dispatchNext();
    });
  }

  private queueInput(strokes: ParticleWorkerPaintStroke[], cursor: ParticleWorkerPoint | undefined) {
    const tail = this.queue[this.queue.length - 1];
    if (tail?.command.type === 'input') {
      mergeStrokes(tail.command.strokes, strokes);
      if (cursor) tail.command.cursor = cursor;
      tail.paintPointCount += strokes.reduce((count, stroke) => count + stroke.points.length, 0);
      return;
    }
    if (this.queue.length + (this.inFlight ? 1 : 0) >= this.maxQueuedOperations) {
      this.fail(new Error('Particle worker input queue exceeded its safe limit; the simulation has stopped.'));
      return;
    }

    const id = this.nextId++;
    const command: ParticleWorkerInput = { type: 'input', id, strokes, ...(cursor ? { cursor } : {}) };
    this.queue.push({
      id,
      command,
      expectedResponse: 'ack',
      paintPointCount: strokes.reduce((count, stroke) => count + stroke.points.length, 0),
      resolve: () => {},
      reject: () => {},
    });
  }

  private flushPendingInput() {
    this.inputFlushScheduled = false;
    if (this.stateValue === 'failed' || this.stateValue === 'disposed') return;
    if (this.pendingStrokes.length === 0 && !this.pendingCursor) return;

    const strokes = this.pendingStrokes;
    const cursor = this.pendingCursor;
    this.pendingStrokes = [];
    this.pendingCursor = undefined;
    this.queueInput(strokes, cursor);
    this.dispatchNext();
  }

  private scheduleInputFlush() {
    if (this.inputFlushScheduled) return;
    this.inputFlushScheduled = true;
    queueMicrotask(() => this.flushPendingInput());
  }

  paint(x: number, y: number, radius: number, material: number) {
    if (this.stateValue === 'failed' || this.stateValue === 'disposed') return;
    if (this.queuedPaintPoints >= this.maxQueuedPaintPoints) {
      this.fail(new Error('Particle paint input queue exceeded its safe limit; the simulation has stopped.'));
      return;
    }

    const last = this.pendingStrokes[this.pendingStrokes.length - 1];
    const point = { x, y };
    if (last && last.radius === radius && last.material === material) last.points.push(point);
    else this.pendingStrokes.push({ radius, material, points: [point] });
    this.queuedPaintPoints++;
    this.scheduleInputFlush();
  }

  moveCursor(x: number, y: number) {
    if (this.stateValue === 'failed' || this.stateValue === 'disposed') return;
    this.pendingCursor = { x, y };
    this.scheduleInputFlush();
  }

  private enqueueVoid(createCommand: (id: number) => ParticleWorkerCommand) {
    void this.enqueue<void>(createCommand).catch(() => {});
  }

  load(preset: string) { return this.enqueue<void>(id => ({ type: 'scene', id, preset })); }
  clear() { return this.enqueue<void>(id => ({ type: 'clear', id })); }
  setPaused(paused: boolean) { this.enqueueVoid(id => ({ type: 'pause', id, paused })); }
  setSpeed(speed: number) { this.enqueueVoid(id => ({ type: 'speed', id, speed })); }
  step() { return this.enqueue<void>(id => ({ type: 'step', id })); }
  advanceTime(milliseconds: number) { return this.enqueue<void>(id => ({ type: 'advance', id, milliseconds })); }
  inspect(x: number, y: number) {
    return this.enqueue<ParticleInspection>(id => ({ type: 'inspect', id, x, y }), 'inspection');
  }

  dispose() {
    if (this.stateValue === 'disposed') return;
    this.stateValue = 'disposed';
    this.clearTimers();
    this.worker?.terminate();
    this.worker = null;
    this.frame?.close();
    this.frame = null;
    const error = new Error('Particle worker was stopped.');
    const outstanding = [...(this.inFlight ? [this.inFlight] : []), ...this.queue];
    this.inFlight = null;
    this.queue = [];
    this.pendingStrokes = [];
    this.pendingCursor = undefined;
    this.queuedPaintPoints = 0;
    for (const operation of outstanding) operation.reject(error);
  }
}
