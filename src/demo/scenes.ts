import type { Simulation } from '../engine/simulation';
import { M } from './materials';
export function loadScene(sim: Simulation, preset: string) {
    sim.clear();
    // Generate shapes directly at the active resolution, including curved edges.
    const sx = sim.width / 240, sy = sim.height / 144;
    const rect = (x: number, y: number, w: number, h: number, t: number) => { for (let yy = Math.floor(y * sy); yy < Math.ceil((y + h) * sy); yy++) for (let xx = Math.floor(x * sx); xx < Math.ceil((x + w) * sx); xx++) sim.set(xx, yy, t); };
    if (preset === 'empty') return;
    if (preset === 'fire') { rect(40, 105, 160, 4, M.Stone); rect(65, 70, 110, 35, M.Wood); rect(95, 64, 40, 6, M.Lava); return; }
    if (preset === 'water') { rect(50, 110, 140, 5, M.Stone); rect(50, 55, 4, 55, M.Stone); rect(186, 55, 4, 55, M.Stone); rect(54, 90, 132, 20, M.Water); rect(95, 42, 45, 12, M.Lava); return; }
    if (preset === 'fracture') { rect(110, 110, 20, 34, M.Stone); rect(118, 75, 4, 35, M.Wood); rect(75, 70, 90, 5, M.Wood); rect(95, 58, 5, 10, M.Acid); return; }
    if (preset === 'float') { rect(20, 140, 200, 4, M.Stone); rect(20, 62, 4, 78, M.Stone); rect(216, 62, 4, 78, M.Stone); rect(24, 90, 192, 50, M.Water); rect(55, 65, 24, 12, M.Wood); rect(105, 62, 20, 16, M.Ice); rect(160, 65, 16, 16, M.Glass); return; }
    if (preset === 'heat') { rect(25, 140, 190, 4, M.Stone); rect(44, 126, 1, 14, M.Glass); rect(80, 126, 1, 14, M.Glass); rect(45, 130, 35, 10, M.Lava); rect(85, 128, 35, 12, M.Ice); rect(170, 128, 25, 12, M.Ice); return; }
    if (preset === 'tip') { rect(20, 140, 200, 4, M.Concrete); rect(95, 100, 10, 40, M.Concrete); rect(95, 88, 50, 12, M.Wood); rect(40, 134, 20, 6, M.Grass); return; }
    if (preset === 'stress') { rect(20, 140, 200, 4, M.Stone); rect(118, 90, 2, 50, M.Concrete); rect(85, 78, 70, 12, M.Concrete); return; }
    if (preset === 'shatter') { rect(20, 140, 200, 4, M.Concrete); rect(45, 50, 18, 18, M.Glass); rect(145, 125, 40, 15, M.Glass); rect(150, 50, 18, 18, M.Glass); return; }
    if (preset === 'fir') {
      rect(0, 135, 240, 9, M.Stone);
      rect(0, 133, 240, 2, M.Sand);
      // Three overlapping, irregular skirts give the crown a tapered fir silhouette.
      const skirts = [
        { top: 18, bottom: 65, reach: 21 },
        { top: 39, bottom: 91, reach: 32 },
        { top: 61, bottom: 126, reach: 45 },
      ];
      for (let y = Math.floor(18 * sy); y < Math.ceil(126 * sy); y++) {
        const ry = y / sy;
        for (let x = Math.floor(73 * sx); x < Math.ceil(167 * sx); x++) {
          const rx = x / sx;
          const crown = skirts.some(({ top, bottom, reach }) => {
            if (ry < top || ry >= bottom) return false;
            const width = 2 + reach * (ry - top) / (bottom - top);
            const needles = 1.4 * Math.sin(rx * 1.7 + ry * .8) + .8 * Math.sin(rx * 3.1 - ry * .35);
            const droop = ry > bottom - 5 ? ((Math.floor(Math.abs(rx - 120) / 4) % 3) - 1) * 1.7 : 0;
            return Math.abs(rx - 120) < width + needles + droop;
          });
          if (crown) sim.set(x, y, M.Grass);
        }
      }
      // Continuous trunk and pitched boughs provide visible structure through the foliage.
      const woodLine = (x1: number, y1: number, x2: number, y2: number, thickness: number) => {
        const steps = Math.ceil(Math.hypot((x2 - x1) * sx, (y2 - y1) * sy));
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          rect(x1 + (x2 - x1) * t - thickness / 2, y1 + (y2 - y1) * t - thickness / 2, thickness, thickness, M.Wood);
        }
      };
      woodLine(120, 134, 120, 29, 2.5);
      for (const [y, reach] of [[52, 13], [67, 20], [83, 27], [101, 35], [117, 42]] as const) {
        woodLine(120, y, 120 - reach * .56, y + 7, 1);
          // Keep the lowest tip inside the crown so grass connects around it.
          woodLine(120, y + 2, 120 + reach * .66, y + (y === 117 ? 6 : 9), 1);
      }
      return;
    }
    for (let x = 0; x < sim.width; x++) {
      const ground = Math.round((117 + 6 * Math.sin(x / sx / 17) + 3 * Math.cos(x / sx / 9)) * sy);
      for (let y = ground; y < sim.height; y++) sim.set(x, y, y < ground + 3 * sy ? M.Sand : M.Stone);
      if (x / sx > 10 && x / sx < 88) for (let y = Math.floor(105 * sy); y < ground; y++) sim.set(x, y, M.Water);
    }
    rect(107, 89, 5, 30, M.Wood); rect(161, 89, 5, 29, M.Wood); rect(103, 88, 67, 5, M.Wood);
    rect(125, 46, 22, 8, M.Lava); rect(202, 99, 15, 14, M.Ice);
    for (let y = Math.floor(65 * sy); y < 108 * sy; y++) for (let x = Math.floor(28 * sx); x < 65 * sx; x++) if ((x / sx - 46) ** 2 + (y / sy - 86) ** 2 < 260) sim.set(x, y, M.Wood);
    rect(44, 89, 5, 27, M.Wood);
  }
