import type { MaterialDefinition } from './config';
// A deliberately coarse heat field keeps nearby-air heating affordable at 60 Hz.
// Temperatures and coefficients are game parameters, not a calibrated heat solver.
export const HEAT_CELL = 8;
export const THERMAL_INTERVAL = 3;

export class ThermalField {
  readonly width: number;
  readonly height: number;
  private heat: Float32Array;
  private next: Float32Array;
  private sources: Float32Array;
  private active = false;
  constructor(width: number, height: number) {
    this.width = Math.ceil(width / HEAT_CELL); this.height = Math.ceil(height / HEAT_CELL);
    this.heat = new Float32Array(this.width * this.height);
    this.next = new Float32Array(this.heat.length); this.sources = new Float32Array(this.heat.length);
  }
  wake() { this.active = true; }
  clear() { this.heat.fill(0); this.next.fill(0); this.sources.fill(0); this.active = false; }
  at(x: number, y: number) { return this.heat[Math.floor(y / HEAT_CELL) * this.width + Math.floor(x / HEAT_CELL)]; }
  update(cells: Uint8Array, temperatures: Float32Array, width: number, materials: readonly MaterialDefinition[]): boolean {
    if (!this.active) return false;
    this.sources.fill(0);
    for (let i = 0; i < cells.length; i++) {
      if (!materials[cells[i]].thermal.source) continue;
      const bin = Math.floor(Math.floor(i / width) / HEAT_CELL) * this.width + Math.floor((i % width) / HEAT_CELL);
      this.sources[bin] = Math.max(this.sources[bin], temperatures[i]);
    }
    let peak = 0;
    for (let pass = 0; pass < 4; pass++) {
      for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
        const i = y * this.width + x, t = this.heat[i];
        const neighbors = (x ? this.heat[i - 1] : 0) + (x + 1 < this.width ? this.heat[i + 1] : 0)
          + (y ? this.heat[i - this.width] : 0) + (y + 1 < this.height ? this.heat[i + this.width] : 0);
        const value = Math.max(this.sources[i], (t + .22 * (neighbors - 4 * t)) * .985);
        this.next[i] = value; peak = Math.max(peak, value);
      }
      [this.heat, this.next] = [this.next, this.heat];
    }
    if (peak < .01) { this.clear(); return false; }
    return true;
  }
}
