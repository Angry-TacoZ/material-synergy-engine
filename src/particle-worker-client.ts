import type { ParticleInspection, ParticleWorkerCommand, ParticleWorkerMessage } from './particle-worker-protocol';

type RequestCommand = ParticleWorkerCommand extends infer Command
  ? Command extends { id: number } ? Omit<Command, 'id'> : never
  : never;

export class ParticleWorkerClient {
  readonly width = 960;
  readonly height = 576;
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: ParticleInspection | void) => void; reject: (error: Error) => void }>();
  frame: ImageBitmap | null = null;
  frameVersion = 0;
  ticks = 0;
  revision = 0;
  hoveredMaterial = 0;

  constructor() {
    this.worker = new Worker(new URL('./particle.worker.ts', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', event => this.receive(event.data as ParticleWorkerMessage));
    this.worker.addEventListener('error', event => this.failAll(new Error(event.message || 'Particle worker failed to start.')));
  }

  private receive(message: ParticleWorkerMessage) {
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
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      request.resolve(message.type === 'inspection' ? message.value : undefined);
    } else if (message.type === 'error') {
      const error = new Error(message.message);
      if (message.id === undefined) this.failAll(error);
      else {
        const request = this.pending.get(message.id);
        if (request) { this.pending.delete(message.id); request.reject(error); }
      }
    }
  }

  private request<T extends ParticleInspection | void>(command: RequestCommand): Promise<T> {
    const id = this.nextId++;
    const payload = { ...command, id } as ParticleWorkerCommand;
    const promise = new Promise<ParticleInspection | void>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.worker.postMessage(payload);
    return promise as Promise<T>;
  }

  private send(command: ParticleWorkerCommand) { this.worker.postMessage(command); }
  private failAll(error: Error) {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  paint(x: number, y: number, radius: number, material: number) { this.send({ type: 'paint', x, y, radius, material }); }
  moveCursor(x: number, y: number) { this.send({ type: 'cursor', x, y }); }
  load(preset: string) { return this.request<void>({ type: 'scene', preset }); }
  clear() { return this.request<void>({ type: 'clear' }); }
  setPaused(paused: boolean) { this.send({ type: 'pause', paused }); }
  setSpeed(speed: number) { this.send({ type: 'speed', speed }); }
  step() { return this.request<void>({ type: 'step' }); }
  advanceTime(milliseconds: number) { return this.request<void>({ type: 'advance', milliseconds }); }
  inspect(x: number, y: number) { return this.request<ParticleInspection>({ type: 'inspect', x, y }); }
  dispose() { this.worker.terminate(); this.frame?.close(); this.frame = null; this.failAll(new Error('Particle worker was stopped.')); }
}
