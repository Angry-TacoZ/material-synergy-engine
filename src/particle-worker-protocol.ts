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

export type ParticleWorkerCommand =
  | { type: 'paint'; x: number; y: number; radius: number; material: number }
  | { type: 'cursor'; x: number; y: number }
  | { type: 'scene'; id: number; preset: string }
  | { type: 'clear'; id: number }
  | { type: 'pause'; paused: boolean }
  | { type: 'speed'; speed: number }
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
