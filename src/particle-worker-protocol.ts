import type { BodyInfo } from './simulation';

export type ParticleInspection = {
  ticks: number;
  counts: Record<string, number>;
  reactions: Record<string, number>;
  bodies: BodyInfo[];
  body: BodyInfo | null;
  temperature: number;
  material: number;
};

export type ParticleWorkerPoint = { x: number; y: number };

export type ParticleWorkerPaintStroke = {
  radius: number;
  material: number;
  points: ParticleWorkerPoint[];
};

export type ParticleWorkerInput = {
  type: 'input';
  id: number;
  strokes: ParticleWorkerPaintStroke[];
  cursor?: ParticleWorkerPoint;
};

export type ParticleWorkerCommand =
  | ParticleWorkerInput
  | { type: 'scene'; id: number; preset: string }
  | { type: 'clear'; id: number }
  | { type: 'pause'; id: number; paused: boolean }
  | { type: 'speed'; id: number; speed: number }
  | { type: 'step'; id: number }
  | { type: 'advance'; id: number; milliseconds: number }
  | { type: 'inspect'; id: number; x: number; y: number };

export type ParticleWorkerMessage =
  | { type: 'ready' }
  | { type: 'frame'; bitmap: ImageBitmap; ticks: number; revision: number; material: number }
  | { type: 'cursor'; material: number }
  | { type: 'ack'; id: number }
  | { type: 'inspection'; id: number; value: ParticleInspection }
  | { type: 'error'; id?: number; message: string };
