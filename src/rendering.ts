import { M, Simulation, materials } from './simulation';

const TILE = 256;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
function hash(x: number, y: number) {
  let n = Math.imul(x + 7919, 374761393) ^ Math.imul(y + 104729, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function tileNoise(px: number, py: number, frequency: number) {
  const x = px / TILE * frequency, y = py / TILE * frequency;
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const h = (cx: number, cy: number) => hash(cx % frequency, cy % frequency);
  return (h(ix, iy) * (1 - u) + h(ix + 1, iy) * u) * (1 - v) + (h(ix, iy + 1) * (1 - u) + h(ix + 1, iy + 1) * u) * v;
}

/** Cached material textures and a small diffuse light field; never changes physics. */
export class MaterialRenderer {
  private tiles: Uint8ClampedArray[] = [];
  private lightWidth: number;
  private lightHeight: number;
  private emitters: Float32Array;
  private horizontal: Float32Array;
  private light: Float32Array;
  private background: Uint8ClampedArray;
  private backgroundImage: Uint8ClampedArray;
  private lightBounds = { left: 0, right: -1, top: 0, bottom: -1 };
  private sky: Uint8ClampedArray;
  private cells: Uint8Array;
  private solid = new Uint8Array(materials.length);

  constructor(private width: number, private height: number) {
    this.lightWidth = Math.ceil(width / 8); this.lightHeight = Math.ceil(height / 8);
    this.emitters = new Float32Array(this.lightWidth * this.lightHeight);
    this.horizontal = new Float32Array(this.emitters.length); this.light = new Float32Array(this.emitters.length);
    this.background = new Uint8ClampedArray(width * height * 3);
    this.backgroundImage = new Uint8ClampedArray(width * height * 4);
    this.sky = new Uint8ClampedArray(height * 3);
    this.cells = new Uint8Array(width * height);
    for (let t = 0; t < materials.length; t++) if (materials[t].state === 'Solid') this.solid[t] = 1;
    for (let y = 0; y < height; y++) {
      this.sky[y * 3] = 18 + y / height * 8; this.sky[y * 3 + 1] = 27 + y / height * 11; this.sky[y * 3 + 2] = 36 + y / height * 14;
      for (let x = 0; x < width; x++) {
        const vignette = 1 - .23 * ((x / width - .5) ** 2 * 2 + (y / height - .4) ** 2);
        for (let c = 0; c < 3; c++) {
          this.background[(y * width + x) * 3 + c] = this.sky[y * 3 + c] * vignette;
          this.backgroundImage[(y * width + x) * 4 + c] = this.background[(y * width + x) * 3 + c];
        }
        this.backgroundImage[(y * width + x) * 4 + 3] = 255;
      }
    }
    this.buildTextures();
  }

  private buildTextures() {
    for (let t = 0; t < materials.length; t++) this.tiles[t] = new Uint8ClampedArray(TILE * TILE * 3);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const fine = hash(x, y), broad = tileNoise(x, y, 12), rough = tileNoise(x, y, 43);
      // Voronoi-like mineral fragments: darker seams and differently lit facets.
      let nearest = 100, second = 100, facet = 0;
      const spacing = TILE / 12, gx = Math.floor(x / spacing), gy = Math.floor(y / spacing);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const cx = gx + dx, cy = gy + dy;
        const hx = (cx + 12) % 12, hy = (cy + 12) % 12;
        const px = (cx + .15 + hash(hx, hy) * .7) * spacing, py = (cy + .15 + hash(hx + 40, hy) * .7) * spacing;
        const distance = Math.hypot(x - px, y - py);
        if (distance < nearest) { second = nearest; nearest = distance; facet = hash(hx + 81, hy); } else if (distance < second) second = distance;
      }
      const seam = second - nearest;
      const rock = .61 + facet * .38 + (rough - .5) * .17 + (fine - .5) * .12 - (seam < .65 ? .23 : 0);
      const grain = Math.sin(y / TILE * Math.PI * 80 + Math.sin(x / TILE * Math.PI * 2) * 1.8 + broad * .6);
      const wood = .72 + broad * .23 + grain * .085 + (fine - .5) * .08;
      const molten = tileNoise(x, y, 23) * .65 + tileNoise(x, y, 85) * .35;
      const iceVein = seam < .8 ? .24 : 0;
      const colors: number[][] = [
        [0, 0, 0],
        [219 + fine * 30, 173 + fine * 29, 95 + fine * 25],
        [25 + broad * 12, 104 + rough * 25, 174 + broad * 35],
        [192 * wood, 119 * wood, 57 * wood],
        [157 * rock, 168 * rock, 181 * rock],
        molten < .26 ? [69 + molten * 180, 29, 21] : [240 + molten * 15, 45 + molten * 150, 9 + molten * 40],
        [255, 145 + broad * 103, 30 + broad * 93],
        [88 + broad * 32, 79 + broad * 27, 25 + rough * 15],
        [86 + facet * 30 + iceVein * 230, 160 + facet * 37 + iceVein * 150, 202 + facet * 32 + iceVein * 100],
        [235, 244, 250], [100, 112, 129],
        [208 + fine * 45, 216 + fine * 36, 217 + fine * 33],
        [26 + broad * 15, 127 + rough * 27, 158 + broad * 33],
        [61 + broad * 25, 147 + rough * 25, 140 + broad * 29],
        [123 + fine * 38, 119 + fine * 36, 116 + fine * 35],
        [115 + broad * 31, 202 + rough * 48, 24 + fine * 19],
        [151 + rough * 35 + fine * 16, 157 + rough * 34 + fine * 16, 148 + rough * 30 + fine * 16],
        [40 + fine * 29 + grain * 8, 132 + broad * 66 + grain * 14, 24 + fine * 25],
        [137 + fine * 42, 143 + fine * 40, 132 + fine * 37],
        [71 + facet * 55 + fine * 24, 169 + facet * 43 + fine * 24, 163 + facet * 42 + fine * 24],
      ];
      for (let t = 0; t < materials.length; t++) for (let c = 0; c < 3; c++) this.tiles[t][(y * TILE + x) * 3 + c] = colors[t][c];
    }
  }

  private updateLight(cells: Uint8Array) {
    this.emitters.fill(0);
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      const t = cells[y * this.width + x];
      if (t === M.Lava || t === M.Fire) {
        const i = (y >> 3) * this.lightWidth + (x >> 3);
        this.emitters[i] = Math.min(1, this.emitters[i] + (t === M.Lava ? .09 : .07));
      }
    }
    let left = this.lightWidth, right = -1, top = this.lightHeight, bottom = -1;
    for (let y = 0; y < this.lightHeight; y++) for (let x = 0; x < this.lightWidth; x++) if (this.emitters[y * this.lightWidth + x]) {
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    this.lightBounds = { left: (left - 9) * 8, right: (right + 10) * 8, top: (top - 9) * 8, bottom: (bottom + 10) * 8 };
    if (right < 0) { this.light.fill(0); this.lightBounds.right = -1; return; }
    // Separable box diffusion at 1/8 resolution avoids full-size blur work.
    const radius = 4, divisor = radius * 2 + 1;
    for (let pass = 0; pass < 2; pass++) {
    if (pass) this.emitters.set(this.light);
    for (let y = 0; y < this.lightHeight; y++) {
      let sum = 0;
      for (let x = 0; x <= radius; x++) sum += this.emitters[y * this.lightWidth + x];
      for (let x = 0; x < this.lightWidth; x++) {
        this.horizontal[y * this.lightWidth + x] = sum / divisor;
        if (x - radius >= 0) sum -= this.emitters[y * this.lightWidth + x - radius];
        if (x + radius + 1 < this.lightWidth) sum += this.emitters[y * this.lightWidth + x + radius + 1];
      }
    }
    for (let x = 0; x < this.lightWidth; x++) {
      let sum = 0;
      for (let y = 0; y <= radius; y++) sum += this.horizontal[y * this.lightWidth + x];
      for (let y = 0; y < this.lightHeight; y++) {
        this.light[y * this.lightWidth + x] = sum / divisor;
        if (y - radius >= 0) sum -= this.horizontal[(y - radius) * this.lightWidth + x];
        if (y + radius + 1 < this.lightHeight) sum += this.horizontal[(y + radius + 1) * this.lightWidth + x];
      }
    }
    }
  }

  render(image: ImageData, sim: Simulation) {
    sim.copyCellsTo(this.cells);
    this.updateLight(this.cells);
    const pixels = image.data, cells = this.cells, w = this.width;
    pixels.set(this.backgroundImage);
    const bounds = this.lightBounds;
    const empty = (t: number) => t === M.Empty || t === M.Steam || t === M.Smoke;
    for (let y = 0; y < this.height; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, t = cells[i], p = i * 4, bg = i * 3;
      let glow = 0;
      if (x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
        const lx = Math.min(this.lightWidth - 2, x >> 3), ly = Math.min(this.lightHeight - 2, y >> 3), li = ly * this.lightWidth + lx;
        const fx = (x & 7) / 8, fy = (y & 7) / 8;
        glow = (this.light[li] * (1 - fx) + this.light[li + 1] * fx) * (1 - fy) + (this.light[li + this.lightWidth] * (1 - fx) + this.light[li + this.lightWidth + 1] * fx) * fy;
      }
      let r = this.background[bg], g = this.background[bg + 1], b = this.background[bg + 2];
      if (empty(t)) {
        let shadow = 0;
        if (x >= 4 && y >= 6 && this.solid[cells[i - 6 * w - 4]]) shadow += .17;
        if (x >= 9 && y >= 13 && this.solid[cells[i - 13 * w - 9]]) shadow += .12;
        if (x >= 14 && y >= 20 && this.solid[cells[i - 20 * w - 14]]) shadow += .07;
        if (!shadow && !glow) continue;
        r *= 1 - shadow; g *= 1 - shadow; b *= 1 - shadow;
      } else {
        const uv = sim.surfaceUV[i];
        const tile = (((uv >>> 16) & (TILE - 1)) * TILE + ((uv & 65535) & (TILE - 1))) * 3;
        const above = y > 0 ? cells[i - w] : 0, below = y < this.height - 1 ? cells[i + w] : 0;
        let shade = .83;
        if (this.solid[t]) {
          if (empty(above)) shade += .43;
          else if (y > 3 && empty(cells[i - 4 * w])) shade += .25;
          else if (y > 9 && empty(cells[i - 10 * w])) shade += .12;
          if (empty(below)) shade -= .30;
          else if (y < this.height - 4 && empty(cells[i + 4 * w])) shade -= .15;
          if (x > 0 && empty(cells[i - 1])) shade += .20;
          if (x < w - 1 && empty(cells[i + 1])) shade -= .17;
          if (above !== t && this.solid[above]) shade -= .2;
        }
        r = this.tiles[t][tile] * shade; g = this.tiles[t][tile + 1] * shade; b = this.tiles[t][tile + 2] * shade;
        if (t === M.Water || t === M.Saltwater || t === M.Oil || t === M.Acid) {
          const surface = empty(above);
          const shallow = y < 12 || cells[i - 12 * w] !== t;
          const deep = y >= 35 && cells[i - 35 * w] === t;
          const depth = deep ? .61 : shallow ? 1.13 : .85;
          r *= depth; g *= depth; b *= depth;
          if (surface) { const highlight = .6 + .2 * Math.sin(x * .13 + sim.ticks * .045); r += 105 * highlight; g += 139 * highlight; b += 148 * highlight; }
          if (t === M.Water || t === M.Saltwater) { r = r * .87 + this.background[bg] * .13; g = g * .87 + this.background[bg + 1] * .13; b = b * .87 + this.background[bg + 2] * .13; }
        }
        if (t === M.Ice || t === M.Glass) { const alpha = t === M.Ice ? .78 : .55; r = r * alpha + this.background[bg] * (1 - alpha); g = g * alpha + this.background[bg + 1] * (1 - alpha); b = b * alpha + this.background[bg + 2] * (1 - alpha); if (empty(above)) { r += 65; g += 70; b += 75; } }
        if (t === M.Lava || t === M.Fire) { r /= shade; g /= shade; b /= shade; if (t === M.Fire) { const age = clamp(sim.life[i] / 210); g = 70 + age * 180; b = age * 115; } }
      }
      const gain = empty(t) ? 1 : .65;
      pixels[p] = r + glow * 155 * gain; pixels[p + 1] = g + glow * 69 * gain; pixels[p + 2] = b + glow * 15 * gain; pixels[p + 3] = 255;
    }
    return this.cells;
  }
}
