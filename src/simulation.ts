// Particle Lab adapter. Games import the configurable library from ./engine.
import { Simulation as EngineSimulation } from './engine/simulation';
import { labConfig } from './demo/materials';
import { loadScene } from './demo/scenes';
export { materials, M, labConfig } from './demo/materials';
export type { BodyInfo } from './engine/simulation';
export class Simulation extends EngineSimulation {
  constructor(width = 240, height = 144, seed = 42) { super(labConfig, width, height, seed); }
  load(preset: string) { loadScene(this, preset); }
}
