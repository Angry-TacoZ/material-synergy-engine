import { ThermalField, THERMAL_INTERVAL } from './thermal';
import { stressFailures } from './fracture';
import { compileConfig, type WorldConfig } from './config';
const GRAVITY = .06; // Cells per simulation tick squared, identical for all masses.
const MAX_SPEED = 1.5;
type SolidBody = {
  cells: number[]; type: number; mass: number; load: number; displacedMass: number; buoyantLoad: number; movedTick: number;
  velocity: number; travel: number; top: number[]; bottom: number[];
  rows: { left: number; right: number; count: number }[];
  angularVelocity: number; angle: number; buoyancyX: number; buoyancyY: number;
  pose: { x: number; y: number; cell: number }[] | null; tilted: boolean;
  stressKey?: string;
  collisionVelocity?: number;
};
export type BodyInfo = { material: string; cells: number; density: number; mass: number; carriedMass: number; displacedMass: number; velocity: number; angle: number; minX: number; maxX: number; minY: number; maxY: number };
export interface CellReadView extends Iterable<number> {
  readonly length: number;
  readonly [index: number]: number;
  every(predicate: (value: number, index: number, array: CellReadView) => unknown, thisArg?: unknown): boolean;
  slice(start?: number, end?: number): Uint8Array;
}

function createCellReadView(cells: Uint8Array): CellReadView {
  let view: CellReadView;
  view = new Proxy(Object.create(null) as CellReadView, {
    get(_target, property) {
      if (property === 'length') return cells.length;
      if (property === Symbol.iterator) return cells.values.bind(cells);
      if (property === 'every') return (predicate: (value: number, index: number, array: CellReadView) => unknown, thisArg?: unknown) => {
        for (let index = 0; index < cells.length; index++) if (!predicate.call(thisArg, cells[index], index, view)) return false;
        return true;
      };
      if (property === 'slice') return cells.slice.bind(cells);
      if (typeof property === 'string' && /^(0|[1-9]\d*)$/.test(property)) return cells[Number(property)];
      return undefined;
    },
    set() { throw new TypeError('Simulation.cells is read-only; use set(), paint(), fill(), or clear()'); },
    defineProperty() { throw new TypeError('Simulation.cells is read-only; use set(), paint(), fill(), or clear()'); },
    deleteProperty() { throw new TypeError('Simulation.cells is read-only; use set(), paint(), fill(), or clear()'); },
  });
  return view;
}

export class Simulation {
  #cells: Uint8Array;
  /** Live read-only cell access; use set(), paint(), fill(), or clear() to mutate the world. */
  readonly cells: CellReadView;
  life: Uint16Array; moved: Uint8Array; ticks = 0; revision = 0;
  /** Decorative UV coordinates travel with matter; collision rules never read them. */
  surfaceUV: Uint32Array;
  /** Particle temperatures and melting heat move with matter, including fragments. */
  temperature: Float32Array;
  private nextTemperature: Float32Array;
  private fusionHeat: Float32Array;
  private ignitionExposure: Uint16Array;
  private ignitionBits: Uint32Array;
  private occupiedBits: Uint32Array;
  private rowWordCount: number;
  private evaluatingIgnition = false;
  private thermal: ThermalField;
  readonly registry: ReturnType<typeof compileConfig>;
  readonly materials: ReturnType<typeof compileConfig>['materials'];
  reactions: Record<string, number>;
  materialId(key: string) { return this.registry.materialId(key); }
  private count(counter?: string) { if (counter) this.reactions[counter]++; }
  private pendingShatter = new Set<SolidBody>();
  private solidRevision = 0;
  private groupedRevision = -1;
  private solidGroups: SolidBody[] = [];
  private owners: Uint32Array;
  private nextOwners: Uint32Array;
  private seed: number;
  constructor(config: WorldConfig, public width = 240, public height = 144, seed = 42) {
    this.registry = compileConfig(config); this.materials = this.registry.materials; this.reactions = this.registry.counters;
    this.#cells = new Uint8Array(width * height); this.cells = createCellReadView(this.#cells);
    this.life = new Uint16Array(this.#cells.length); this.moved = new Uint8Array(this.#cells.length); this.seed = seed;
    this.owners = new Uint32Array(this.#cells.length);
    this.nextOwners = new Uint32Array(this.#cells.length);
    this.surfaceUV = new Uint32Array(this.#cells.length);
    this.temperature = new Float32Array(this.#cells.length);
    this.nextTemperature = new Float32Array(this.#cells.length);
    this.fusionHeat = new Float32Array(this.#cells.length);
    this.ignitionExposure = new Uint16Array(this.#cells.length);
    this.ignitionBits = new Uint32Array(Math.ceil(this.#cells.length / 32));
    this.rowWordCount = Math.ceil(width / 32);
    this.occupiedBits = new Uint32Array(height * this.rowWordCount);
    this.thermal = new ThermalField(width, height);
  }
  random() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }
  getCell(index: number) { return this.#cells[index]; }
  copyCells() { return this.#cells.slice(); }
  /** Copies the current cells into a caller-owned buffer, suitable for reusable render buffers. */
  copyCellsTo(target: Uint8Array) {
    if (!(target instanceof Uint8Array) || target.length !== this.#cells.length) throw new RangeError(`Expected a Uint8Array of length ${this.#cells.length}`);
    target.set(this.#cells);
  }
  set(x: number, y: number, type: number) { if (x < 0 || y < 0 || x >= this.width || y >= this.height) return; this.change(y * this.width + x, type); }
  /** Fills the world through the normal indexed mutation path. */
  fill(type: number) {
    if (!this.materials[type]) throw new Error(`Unknown material ID: ${type}`);
    if (type === 0) { this.clear(); return; }
    for (let i = 0; i < this.#cells.length; i++) this.change(i, type);
  }
  private change(i: number, type: number) {
    const material = this.materials[type];
    if (!material) throw new Error(`Unknown material ID: ${type}`);
    if (this.materials[this.#cells[i]].state === 'Solid' || material.state === 'Solid') this.solidRevision++;
    this.revision++; this.#cells[i] = type; this.updateIgnitionMembership(i); this.updateOccupied(i); this.temperature[i] = material.thermal.initialTemperature;
    this.fusionHeat[i] = 0; this.ignitionExposure[i] = 0; if (material.thermal.source) this.thermal.wake();
    this.surfaceUV[i] = (Math.floor(i / this.width) << 16) | (i % this.width);
    this.life[i] = material.lifetime ? material.lifetime.min + Math.floor(this.random() * material.lifetime.range) : 0;
    this.moved[i] = 1;
  }
  clear() { this.solidRevision++; this.revision++; this.#cells.fill(0); this.life.fill(0); this.surfaceUV.fill(0); this.temperature.fill(0); this.nextTemperature.fill(0); this.fusionHeat.fill(0); this.ignitionExposure.fill(0); this.ignitionBits.fill(0); this.occupiedBits.fill(0); this.thermal.clear(); this.pendingShatter.clear(); this.owners.fill(0); this.nextOwners.fill(0); this.solidGroups = []; this.ticks = 0; for (const k of Object.keys(this.reactions) as (keyof typeof this.reactions)[]) this.reactions[k] = 0; }
  paint(x: number, y: number, radius: number, type: number) { for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) if (dx * dx + dy * dy <= radius * radius) { const px = x + dx, py = y + dy; if (px >= 0 && py >= 0 && px < this.width && py < this.height && (type === 0 || this.#cells[py * this.width + px] === 0)) this.set(px, py, type); } }
  private updateIgnitionMembership(i: number) {
    if (this.evaluatingIgnition) return;
    const word = i >>> 5, bit = 1 << (i & 31);
    if (this.materials[this.#cells[i]].thermal.heatIgnition) this.ignitionBits[word] |= bit;
    else this.ignitionBits[word] &= ~bit;
  }
  private updateOccupied(i: number) {
    const x = i % this.width, word = Math.floor(i / this.width) * this.rowWordCount + (x >>> 5), bit = 1 << (x & 31);
    if (this.#cells[i]) this.occupiedBits[word] |= bit;
    else this.occupiedBits[word] &= ~bit;
  }
  private swap(a: number, b: number) { [this.#cells[a], this.#cells[b]] = [this.#cells[b], this.#cells[a]]; [this.life[a], this.life[b]] = [this.life[b], this.life[a]]; const uv = this.surfaceUV[a]; this.surfaceUV[a] = this.surfaceUV[b]; this.surfaceUV[b] = uv; const temp = this.temperature[a]; this.temperature[a] = this.temperature[b]; this.temperature[b] = temp; const fusion = this.fusionHeat[a]; this.fusionHeat[a] = this.fusionHeat[b]; this.fusionHeat[b] = fusion; const exposure = this.ignitionExposure[a]; this.ignitionExposure[a] = this.ignitionExposure[b]; this.ignitionExposure[b] = exposure; this.updateIgnitionMembership(a); this.updateIgnitionMembership(b); this.updateOccupied(a); this.updateOccupied(b); this.moved[a] = this.moved[b] = 1; }
  private adjacent(i: number) {
    const x = i % this.width;
    return [x > 0 ? i - 1 : -1, x < this.width - 1 ? i + 1 : -1, i >= this.width ? i - this.width : -1, i + this.width < this.#cells.length ? i + this.width : -1].filter(n => n >= 0);
  }
  private groupSolids() {
    if (this.groupedRevision !== this.solidRevision) {
      const previous = this.solidGroups;
      this.nextOwners.fill(0); this.solidGroups = [];
      for (let i = this.#cells.length - 1; i >= 0; i--) {
        if (this.nextOwners[i] || this.materials[this.#cells[i]].state !== 'Solid') continue;
        const type = this.#cells[i], group = [i], id = this.solidGroups.length + 1;
        this.nextOwners[i] = id;
        for (let q = 0; q < group.length; q++) for (let side = 0; side < 4; side++) {
          const cell = group[q], x = cell % this.width;
          const n = side === 0 ? (x ? cell - 1 : -1) : side === 1 ? (x + 1 < this.width ? cell + 1 : -1) : side === 2 ? cell - this.width : cell + this.width;
          if (n >= 0 && n < this.#cells.length && !this.nextOwners[n] && this.#cells[n] === type) { this.nextOwners[n] = id; group.push(n); }
        }
        group.sort((a, b) => b - a);
        const rows: SolidBody['rows'] = [];
        for (const index of group) {
          const last = rows[rows.length - 1];
          if (last && index === last.left - 1 && Math.floor(index / this.width) === Math.floor(last.left / this.width)) { last.left = index; last.count++; }
          else rows.push({ left: index, right: index, count: 1 });
        }
        const mass = group.length * this.materials[type].density / 1000;
        let velocity = 0, travel = 0, angularVelocity = 0, angle = 0;
        for (const index of group) { const old = previous[this.owners[index] - 1]; if (old) { velocity += old.velocity; travel += old.travel; angularVelocity += old.angularVelocity; angle += old.angle; } }
        const oldId = this.owners[group[0]], old = previous[oldId - 1];
        const unchanged = old && old.type === type && old.cells.length === group.length && group.every(i => this.owners[i] === oldId);
        this.solidGroups.push({ cells: group, type, mass, load: mass, displacedMass: 0, buoyantLoad: 0, movedTick: -1, velocity: velocity / group.length, travel: travel / group.length, top: [], bottom: [], rows, angularVelocity: angularVelocity / group.length, angle: angle / group.length, buoyancyX: 0, buoyancyY: 0, pose: unchanged ? old.pose : null, tilted: unchanged ? old.tilted : false, stressKey: unchanged ? old.stressKey : undefined });
      }
      this.owners.set(this.nextOwners);
      for (let g = 0; g < this.solidGroups.length; g++) {
        const body = this.solidGroups[g], id = g + 1;
        body.top = body.cells.filter(i => i < this.width || this.owners[i - this.width] !== id);
        body.bottom = body.cells.filter(i => i + this.width >= this.#cells.length || this.owners[i + this.width] !== id);
      }
      this.groupedRevision = this.solidRevision;
    }
  }
  private fluidDensity(i: number) {
    if (i < 0 || i >= this.#cells.length) return 0;
    const t = this.#cells[i];
    return this.materials[t].state === 'Liquid' ? this.materials[t].density / 1000 : 0;
  }
  private buoyancy(body: SolidBody) {
    let displaced = 0, momentX = 0, momentY = 0;
    // Infer immersion from fluid alongside each solid row. This preserves a
    // partially submerged surface rather than floating on the first wet cell.
    const topFluid = body.top.some(i => this.fluidDensity(i - this.width) > 0);
    const bottomFluid = body.bottom.some(i => this.fluidDensity(i + this.width) > 0);
    let enclosedDensity = 0;
    if (topFluid && bottomFluid) for (const i of body.bottom) enclosedDensity = Math.max(enclosedDensity, this.fluidDensity(i + this.width));
    for (const row of body.rows) {
      const left = row.left % this.width > 0 ? row.left - 1 : -1;
      const right = row.right % this.width < this.width - 1 ? row.right + 1 : -1;
      const a = this.fluidDensity(left), b = this.fluidDensity(right);
      const wallA = left >= 0 && this.materials[this.#cells[left]].state === 'Solid';
      const wallB = right >= 0 && this.materials[this.#cells[right]].state === 'Solid';
      const density = a && b ? (a + b) / 2 : a ? a * (wallB ? 1 : .5) : b ? b * (wallA ? 1 : .5) : wallA && wallB ? enclosedDensity : 0;
      const mass = row.count * density;
      displaced += mass; momentX += mass * ((row.left % this.width + row.right % this.width) / 2);
      momentY += mass * Math.floor(row.left / this.width);
    }
    body.buoyancyX = displaced ? momentX / displaced : 0; body.buoyancyY = displaced ? momentY / displaced : 0;
    return displaced;
  }
  private supportedLoads() {
    const above: { id: number; fraction: number }[][] = this.solidGroups.map(() => []);
    for (let g = 0; g < this.solidGroups.length; g++) {
      const contacts = new Map<number, number>(); let contactCount = 0;
      for (const i of this.solidGroups[g].bottom) {
        const n = i + this.width;
        if (n >= this.#cells.length) { contactCount++; continue; }
        const owner = this.owners[n];
        if (owner && owner !== g + 1) { contacts.set(owner - 1, (contacts.get(owner - 1) || 0) + 1); contactCount++; }
        else if (this.materials[this.#cells[n]].state === 'Powder') contactCount++;
      }
      for (const [support, count] of contacts) above[support].push({ id: g, fraction: count / contactCount });
    }
    const done = new Uint8Array(this.solidGroups.length), active = new Uint8Array(done.length);
    const load = (id: number): number => {
      if (done[id]) return this.solidGroups[id].load;
      if (active[id]) return 0; // Interlocked pieces must not recursively amplify weight.
      active[id] = 1;
      const body = this.solidGroups[id];
      body.load = body.mass; body.buoyantLoad = body.displacedMass;
      for (const other of above[id]) {
        if (active[other.id]) continue;
        body.load += load(other.id) * other.fraction;
        body.buoyantLoad += this.solidGroups[other.id].buoyantLoad * other.fraction;
      }
      active[id] = 0; done[id] = 1; return body.load;
    };
    for (let i = 0; i < done.length; i++) load(i);
  }
  private liftStack(id: number) {
    const moving = new Set<number>();
    const collect = (g: number): boolean => {
      if (moving.has(g)) return true;
      moving.add(g);
      for (const i of this.solidGroups[g].top) {
        const n = i - this.width;
        if (n < 0 || this.materials[this.#cells[n]].state === 'Powder') return false;
        const owner = this.owners[n];
        if (owner && owner !== g + 1 && !collect(owner - 1)) return false;
      }
      return true;
    };
    if (!collect(id)) return false;
    const cells = [...moving].flatMap(g => this.solidGroups[g].cells).sort((a, b) => a - b);
    for (const i of cells) this.owners[i] = 0;
    for (const i of cells) this.swap(i, i - this.width);
    for (const g of moving) {
      const body = this.solidGroups[g];
      for (let q = 0; q < body.cells.length; q++) { body.cells[q] -= this.width; this.owners[body.cells[q]] = g + 1; }
      for (let q = 0; q < body.top.length; q++) body.top[q] -= this.width;
      for (let q = 0; q < body.bottom.length; q++) body.bottom[q] -= this.width;
      for (const row of body.rows) { row.left -= this.width; row.right -= this.width; }
      if (body.pose) for (const point of body.pose) { point.y--; point.cell -= this.width; }
      if (g !== id) { body.velocity = this.solidGroups[id].velocity; body.travel = 0; }
      body.movedTick = this.ticks;
      for (const i of body.cells) if (this.adjacent(i).some(n => this.#cells[n] === body.type && this.owners[n] !== g + 1)) { this.solidRevision++; break; }
    }
    this.revision++; return true;
  }
  private moveBody(id: number, direction: number) {
    const body = this.solidGroups[id], delta = direction * this.width;
    const boundary = direction > 0 ? body.bottom : body.top;
    const powder: number[] = [], pushes: [number, number][] = [], reserved = new Set<number>();
    for (const i of boundary) {
      const n = i + delta;
      if (n < 0 || n >= this.#cells.length) { if (direction > 0) this.registerImpact(body); return false; }
      const owner = this.owners[n];
      if (owner && owner !== id + 1) {
        if (direction < 0 && body.buoyantLoad > body.load) return this.liftStack(id);
        const other = this.solidGroups[owner - 1];
        if (direction > 0) this.registerImpact(body, other);
        const shared = (body.mass * body.velocity + other.mass * other.velocity) / (body.mass + other.mass);
        if (direction > 0 && shared > 0) other.velocity = shared;
        if (direction > 0 && !other.bottom.some(i => i + this.width >= this.#cells.length)) body.collisionVelocity = Math.max(0, shared);
        return false;
      }
      if (this.materials[this.#cells[n]].state === 'Powder') powder.push(n);
    }
    // A body's available force must overcome the mass of the loose particles
    // it pushes. No connected solid is erased or treated as a loose particle.
    const force = direction * (body.load - body.buoyantLoad) + body.mass * Math.max(0, direction * body.velocity) * .5;
    const resistance = powder.reduce((sum, i) => sum + this.materials[this.#cells[i]].density / 1000, 0) * 2;
    if (powder.length && force <= resistance) return false;
    for (const i of powder) {
      const x = i % this.width; let target = -1;
      const blockedSides = new Set<number>();
      // A wide falling slab must be able to push grains beyond its footprint.
      // A fixed six-cell search could let one loose grain pin an entire slab.
      for (let distance = 1; distance < this.width && target < 0; distance++) for (const side of [-1, 1]) {
        if (blockedSides.has(side)) continue;
        const nx = x + side * distance;
        if (nx < 0 || nx >= this.width) continue;
        const n = i + side * distance, t = this.#cells[n];
        if (this.materials[t].state === 'Solid') { blockedSides.add(side); continue; }
        if (reserved.has(n) || (n - delta >= 0 && n - delta < this.#cells.length && this.owners[n - delta] === id + 1)) continue;
        if (!t || ((this.materials[t].state === 'Liquid' || this.materials[t].state === 'Gas') && this.materials[t].density < this.materials[this.#cells[i]].density)) { target = n; break; }
      }
      // Trapped loose rubble is displaced through the body's vacated cells,
      // like fluid, when the available weight already exceeds its resistance.
      // It must not become an immovable anchor in an otherwise empty scene.
      if (target < 0 && this.materials[this.#cells[i]].displaceWhenTrapped) continue;
      if (target < 0) return false;
      reserved.add(target); pushes.push([i, target]);
    }
    for (const [a, b] of pushes) this.swap(a, b);
    for (const i of body.cells) this.owners[i] = 0;
    // Downward movement is bottom-first; upward buoyancy is top-first.
    if (direction > 0) for (let q = 0; q < body.cells.length; q++) { this.swap(body.cells[q], body.cells[q] + delta); body.cells[q] += delta; }
    else for (let q = body.cells.length - 1; q >= 0; q--) { this.swap(body.cells[q], body.cells[q] + delta); body.cells[q] += delta; }
    for (const i of body.cells) this.owners[i] = id + 1;
    for (let q = 0; q < body.top.length; q++) body.top[q] += delta;
    for (let q = 0; q < body.bottom.length; q++) body.bottom[q] += delta;
    for (const row of body.rows) { row.left += delta; row.right += delta; }
    if (body.pose) for (const point of body.pose) { point.y += direction; point.cell += delta; }
    this.revision++;
    body.movedTick = this.ticks;
    if (direction > 0) for (const i of body.bottom) {
      const n = i + this.width;
      if (n >= this.#cells.length) this.registerImpact(body);
      else if (this.owners[n] && this.owners[n] !== id + 1) this.registerImpact(body, this.solidGroups[this.owners[n] - 1]);
    }
    for (const i of body.cells) if (this.adjacent(i).some(n => this.#cells[n] === body.type && this.owners[n] !== id + 1)) { this.solidRevision++; break; }
    return true;
  }
  private solidGravity() {
    this.groupSolids();
    for (const body of this.solidGroups) body.displacedMass = this.buoyancy(body);
    this.supportedLoads();
    for (let g = 0; g < this.solidGroups.length; g++) {
      const body = this.solidGroups[g];
      if (this.pendingShatter.has(body)) continue;
      if (body.movedTick === this.ticks) continue;
      const acceleration = GRAVITY * (1 - body.buoyantLoad / body.load);
      body.velocity += acceleration;
      if (body.displacedMass > 0) body.velocity *= .86; // Fluid drag, independent of total size.
      body.velocity = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, body.velocity));
      if (Math.abs(acceleration) < GRAVITY * .025 && Math.abs(body.velocity) < .04) { body.velocity = 0; body.travel = 0; }
      body.travel += body.velocity;
      let steps = Math.min(2, Math.floor(Math.abs(body.travel))), direction = Math.sign(body.travel);
      while (steps-- > 0) {
        body.collisionVelocity = undefined;
        if (!this.moveBody(g, direction)) { body.velocity = body.collisionVelocity ?? 0; body.travel = 0; break; }
        body.travel -= direction;
      }
    }
    if (this.ticks % 3 === 0) for (let g = 0; g < this.solidGroups.length; g++) this.tipBody(g);
    for (const body of this.pendingShatter) {
      const failure = this.materials[body.type].failure!.impact!;
      for (const i of body.cells) if (this.#cells[i] === body.type) {
        const temp = this.temperature[i]; this.change(i, this.materialId(failure.output)); this.temperature[i] = temp; this.count(failure.counter);
      }
    }
    this.pendingShatter.clear();
  }
  private registerImpact(body: SolidBody, other?: SolidBody) {
    const speed = body.velocity - (other?.velocity ?? 0);
    const failure = this.materials[body.type].failure?.impact;
    if (failure && speed >= failure.minRelativeSpeed && (!other || this.materials[other.type].collision?.hard)) this.pendingShatter.add(body);
    const otherFailure = other && this.materials[other.type].failure?.impact;
    if (other && otherFailure && speed >= otherFailure.minRelativeSpeed && this.materials[body.type].collision?.hard) this.pendingShatter.add(other);
  }
  private tipBody(id: number) {
    const body = this.solidGroups[id];
    if (this.pendingShatter.has(body)) return;
    if (body.cells.length < 3) return;
    let cx = 0, cy = 0, minX = this.width, maxX = 0, minY = this.height, maxY = 0;
    for (const row of body.rows) {
      const x = (row.left % this.width + row.right % this.width) / 2, y = Math.floor(row.left / this.width);
      cx += x * row.count; cy += y * row.count;
      minX = Math.min(minX, row.left % this.width); maxX = Math.max(maxX, row.right % this.width);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    cx /= body.cells.length; cy /= body.cells.length;
    let left = Infinity, right = -Infinity, supportY = 0;
    for (const i of body.bottom) {
      const n = i + this.width;
      if (n >= this.#cells.length || (this.owners[n] && this.owners[n] !== id + 1) || (n < this.#cells.length && this.materials[this.#cells[n]].state === 'Powder')) {
        left = Math.min(left, i % this.width); right = Math.max(right, i % this.width); supportY = Math.max(supportY, Math.floor(i / this.width) + .5);
      }
    }
    let pivotX = cx, pivotY = cy, torque = 0;
    if (left !== Infinity) {
      // Tip only when the centre of mass lies beyond the supporting footprint.
      if (cx > right + .5) { pivotX = right + .5; pivotY = supportY; torque = body.load * GRAVITY * (cx - pivotX); }
      else if (cx < left - .5) { pivotX = left - .5; pivotY = supportY; torque = body.load * GRAVITY * (cx - pivotX); }
      else { body.angularVelocity *= .6; }
    } else if (body.displacedMass > 0) {
      torque = -body.displacedMass * GRAVITY * (body.buoyancyX - cx);
      // An exactly upright slender floating shape is an unstable equilibrium.
      // Give it one tiny perturbation so finite-grid symmetry does not pin it.
      if (!body.tilted && maxY - minY > (maxX - minX + 1) * 1.5 && cy < body.buoyancyY - 1) {
        body.angularVelocity += .002; body.tilted = true;
      }
    }
    const inertia = body.mass * ((maxX - minX + 1) ** 2 + (maxY - minY + 1) ** 2) / 12;
    body.angularVelocity = Math.max(-.012, Math.min(.012, (body.angularVelocity + 3 * torque / Math.max(1, inertia)) * (body.displacedMass ? .94 : .99)));
    if (Math.abs(body.angularVelocity) < .0001) return;
    const angle = body.angularVelocity * 3, cos = Math.cos(angle), sin = Math.sin(angle);
    const pose = body.pose ?? body.cells.map(cell => ({ x: cell % this.width, y: Math.floor(cell / this.width), cell }));
    const reserved = new Set<number>(), candidates: { x: number; y: number; cell: number; old: number }[] = [];
    for (const point of pose) {
      const dx = point.x - pivotX, dy = point.y - pivotY;
      const x = pivotX + dx * cos - dy * sin, y = pivotY + dx * sin + dy * cos;
      const rx = Math.round(x), ry = Math.round(y); let target = -1, best = Infinity;
      // Rounded rigid coordinates can share a voxel. Assign the nearest free
      // voxel deterministically, preserving every cell and its metadata.
      for (let radius = 0; radius <= 2 && target < 0; radius++) {
        for (let yy = ry - radius; yy <= ry + radius; yy++) for (let xx = rx - radius; xx <= rx + radius; xx++) {
          if (xx < 0 || xx >= this.width || yy < 0 || yy >= this.height) continue;
          const n = yy * this.width + xx, t = this.#cells[n];
          if (reserved.has(n) || (this.owners[n] !== id + 1 && t && this.materials[t].state !== 'Liquid' && this.materials[t].state !== 'Gas')) continue;
          const distance = (xx - x) ** 2 + (yy - y) ** 2;
          if (distance < best) { best = distance; target = n; }
        }
      }
      if (target < 0 || Math.abs(target % this.width - x) > 2 || Math.abs(Math.floor(target / this.width) - y) > 2) { body.angularVelocity = 0; return; }
      reserved.add(target); candidates.push({ x, y, cell: target, old: point.cell });
    }
    const record = (i: number) => ({ type: this.#cells[i], life: this.life[i], uv: this.surfaceUV[i], temp: this.temperature[i], fusion: this.fusionHeat[i], exposure: this.ignitionExposure[i] });
    const matter = candidates.map(p => record(p.old));
    const displaced = candidates.filter(p => this.owners[p.cell] !== id + 1).map(p => record(p.cell));
    const vacated = body.cells.filter(i => !reserved.has(i));
    const put = (i: number, r: ReturnType<typeof record>) => { this.#cells[i] = r.type; this.updateIgnitionMembership(i); this.updateOccupied(i); this.life[i] = r.life; this.surfaceUV[i] = r.uv; this.temperature[i] = r.temp; this.fusionHeat[i] = r.fusion; this.ignitionExposure[i] = r.exposure; this.moved[i] = 1; };
    for (const i of body.cells) this.owners[i] = 0;
    for (let q = 0; q < vacated.length; q++) put(vacated[q], displaced[q]);
    for (let q = 0; q < candidates.length; q++) { put(candidates[q].cell, matter[q]); this.owners[candidates[q].cell] = id + 1; }
    body.pose = candidates.map(({ x, y, cell }) => ({ x, y, cell })); body.angle += angle;
    body.cells = candidates.map(p => p.cell).sort((a, b) => b - a); body.rows = [];
    for (const i of body.cells) {
      const last = body.rows[body.rows.length - 1];
      if (last && i === last.left - 1 && Math.floor(i / this.width) === Math.floor(last.left / this.width)) { last.left = i; last.count++; }
      else body.rows.push({ left: i, right: i, count: 1 });
    }
    body.top = body.cells.filter(i => i < this.width || this.owners[i - this.width] !== id + 1);
    body.bottom = body.cells.filter(i => i + this.width >= this.#cells.length || this.owners[i + this.width] !== id + 1);
    // Rotation can open voxel gaps as coordinates are rounded. Recheck bonds
    // before the next gravity pass so disconnected islands cannot remain pinned
    // to a grounded part through stale component membership.
    this.solidRevision++;
    this.revision++;
  }
  private describeBody(body: SolidBody): BodyInfo {
    let minX = this.width, maxX = 0, minY = this.height, maxY = 0;
    for (const row of body.rows) { minX = Math.min(minX, row.left % this.width); maxX = Math.max(maxX, row.right % this.width); minY = Math.min(minY, Math.floor(row.left / this.width)); maxY = Math.max(maxY, Math.floor(row.left / this.width)); }
    return { material: this.materials[body.type].name, cells: body.cells.length, density: this.materials[body.type].density, mass: body.mass, carriedMass: body.load - body.mass, displacedMass: body.displacedMass, velocity: body.velocity, angle: body.angle, minX, maxX, minY, maxY };
  }
  bodyAt(x: number, y: number): BodyInfo | null {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    const i = y * this.width + x;
    if (this.materials[this.#cells[i]].state !== 'Solid') return null;
    this.groupSolids(); return this.describeBody(this.solidGroups[this.owners[i] - 1]);
  }
  bodySummaries(limit = 8) { this.groupSolids(); return this.solidGroups.slice(0, limit).map(body => this.describeBody(body)); }
  temperatureAt(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    const i = y * this.width + x;
    return this.#cells[i] ? this.temperature[i] : this.thermal.at(x, y);
  }
  private transferHeat() {
    if (this.ticks % THERMAL_INTERVAL) return;
    if (!this.thermal.update(this.#cells, this.temperature, this.width, this.materials)) {
      return;
    }
    // Double buffering prevents scan direction from deciding which side heats first.
    this.nextTemperature.set(this.temperature);
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      const i = y * this.width + x, type = this.#cells[i];
      if (!type || this.materials[type].thermal.source) continue;
      const temp = this.temperature[i], { capacity, airTransfer, phaseChange } = this.materials[type].thermal;
      let exchange = 0, exposed = false;
      for (let side = 0; side < 4; side++) {
        const n = side === 0 ? (x ? i - 1 : -1) : side === 1 ? (x + 1 < this.width ? i + 1 : -1) : side === 2 ? (y ? i - this.width : -1) : (y + 1 < this.height ? i + this.width : -1);
        if (n < 0 || !this.#cells[n] || this.materials[this.#cells[n]].state === 'Gas') { exposed = true; continue; }
        // The less conductive participant limits exchange.
        const conductivity = Math.min(this.materials[type].thermal.conductivity, this.materials[this.#cells[n]].thermal.conductivity);
        exchange += conductivity * (this.temperature[n] - temp);
      }
      if (exposed || this.materials[type].state === 'Gas') exchange += airTransfer * (this.thermal.at(x, y) - temp);
      let next = temp + exchange / capacity;
      if (phaseChange && next > phaseChange.point) {
        this.fusionHeat[i] += (next - phaseChange.point) * capacity; next = phaseChange.point; // Heat goes into melting at the phase boundary.
      }
      this.nextTemperature[i] = next;
    }
    this.temperature.set(this.nextTemperature);
    for (let i = 0; i < this.#cells.length; i++) {
      const phase = this.materials[this.#cells[i]].thermal.phaseChange;
      if (phase && this.fusionHeat[i] >= phase.heat) { this.change(i, this.materialId(phase.output)); this.count(phase.counter); }
    }
  }
  private evaluateHeatIgnition() {
    // Exposure depends on particle temperature, even while the spatial heat field sleeps.
    if (!this.ignitionBits.some(Boolean)) return;
    this.evaluatingIgnition = true;
    for (let wordIndex = 0; wordIndex < this.ignitionBits.length; wordIndex++) {
      let word = this.ignitionBits[wordIndex];
      while (word) {
        const bit = word & -word;
        word &= word - 1;
        const i = (wordIndex << 5) + 31 - Math.clz32(bit);
        const ignition = this.materials[this.#cells[i]].thermal.heatIgnition;
        if (!ignition) continue;
        this.ignitionExposure[i] = this.temperature[i] >= ignition.point ? Math.min(65535, this.ignitionExposure[i] + 1) : 0;
        if (this.ignitionExposure[i] >= ignition.holdTicks) { this.change(i, this.materialId(ignition.output)); this.count(ignition.counter); }
        if (!this.materials[this.#cells[i]].thermal.heatIgnition) this.ignitionBits[wordIndex] &= ~bit;
      }
    }
    this.evaluatingIgnition = false;
  }
  private fractureSolids() {
    for (let id = 0; id < this.solidGroups.length; id++) {
      const body = this.solidGroups[id], material = this.materials[body.type], failure = material.failure?.stress;
      if (!failure || this.ticks % failure.interval || body.cells.length < failure.minCells) continue;
      const supports = body.bottom.filter(i => {
        const n = i + this.width;
        return n >= this.#cells.length || (this.owners[n] && this.owners[n] !== id + 1) || (n < this.#cells.length && this.materials[this.#cells[n]].state === 'Powder');
      });
      const key = `${body.load}:${body.angle}:${body.cells[0]}:${supports.join(',')}`;
      if (key === body.stressKey) continue;
      body.stressKey = key;
      const failures = stressFailures(body.cells, this.width, supports, material.density, body.load / body.mass, failure, GRAVITY);
      for (const i of failures) { const temp = this.temperature[i]; this.change(i, this.materialId(failure.output)); this.temperature[i] = temp; this.count(failure.counter); }
    }
  }
  step() {
    this.ticks++; this.moved.fill(0);
    this.transferHeat();
    this.evaluateHeatIgnition();
    const noNeighbors: number[] = [];
    const reverse = this.ticks % 2 === 0;
    for (let y = this.height - 1; y >= 0; y--) for (let wordOffset = 0; wordOffset < this.rowWordCount; wordOffset++) {
      const wordIndex = y * this.rowWordCount + (reverse ? this.rowWordCount - 1 - wordOffset : wordOffset);
      let unvisited = 0xffff_ffff;
      while (true) {
      const occupied = this.occupiedBits[wordIndex] & unvisited;
      if (!occupied) break;
      const bit = reverse ? (1 << (31 - Math.clz32(occupied))) : occupied & -occupied;
      unvisited = reverse ? bit - 1 : unvisited & ~bit;
      const x = ((reverse ? this.rowWordCount - 1 - wordOffset : wordOffset) << 5) + 31 - Math.clz32(bit);
      if (x >= this.width) continue;
      const i = y * this.width + x;
      if (!this.#cells[i] || this.moved[i]) continue;
      let t = this.#cells[i];
      const neighbors = this.registry.actors[t] ? this.adjacent(i) : noNeighbors;
      let stop = false;
      for (const n of neighbors) {
        for (const rule of this.registry.rules[t][this.#cells[n]]) {
          const condition = rule.conditions;
          if (condition?.minTemperature !== undefined && this.temperature[i] < condition.minTemperature) continue;
          if (condition?.maxTemperature !== undefined && this.temperature[i] > condition.maxTemperature) continue;
          if (condition?.probability !== undefined && this.random() >= condition.probability) continue;
          for (const output of rule.outputs) {
            const target = output.target === 'self' ? i : output.target === 'neighbor' ? n : neighbors.find(k => !this.#cells[k]);
            if (target !== undefined) this.change(target, output.material);
          }
          this.count(rule.counter);
          if (rule.stop) { stop = true; break; }
        }
        if (stop) break;
      }
      t = this.#cells[i]; if (this.moved[i]) continue;
      const lifetime = this.materials[t].lifetime;
      if (lifetime) {
        if (this.life[i] > 0) this.life[i]--;
        if (!this.life[i]) { this.change(i, this.materialId(lifetime.output)); this.count(lifetime.counter); continue; }
        const spawn = lifetime.spawnAbove;
        if (spawn && this.random() < spawn.chance && y > 0 && !this.#cells[i - this.width]) this.change(i - this.width, this.materialId(spawn.output));
      }
      const state = this.materials[t].state;
      if (state === 'Solid') continue;
      const gas = state === 'Gas';
      const buoyantPowder = state === 'Powder' && y > 0 && this.fluidDensity(i - this.width) > this.materials[t].density / 1000;
      const direction = gas || buoyantPowder ? -1 : 1, ny = y + direction, side = this.random() < .5 ? -1 : 1;
      if (gas && y === 0) { this.change(i, 0); continue; }
      // Vapor does not rise in lockstep: pauses and sideways drift break up rows.
      const motion = this.materials[t].motion;
      if (motion?.pauseChance !== undefined && this.random() < motion.pauseChance) continue;
      if (motion?.stepEvery && this.ticks % motion.stepEvery) continue;
      const canMove = (n: number) => {
        const other = this.#cells[n];
        if (!other) return true;
        const otherState = this.materials[other].state;
        if (otherState !== 'Liquid' && otherState !== 'Gas') return false;
        return direction > 0 ? this.materials[t].density > this.materials[other].density : this.materials[t].density < this.materials[other].density;
      };
      let dest = -1;
      const upwardChoices = motion?.diagonalFirstChance !== undefined && this.random() < motion.diagonalFirstChance ? [side, 0, -side] : [0, side, -side];
      if (ny >= 0 && ny < this.height) for (const dx of upwardChoices) { const nx = x + dx; if (nx >= 0 && nx < this.width && canMove(ny * this.width + nx)) { dest = ny * this.width + nx; break; } }
      if (dest < 0 && (state === 'Liquid' || gas)) for (const dx of [side, -side]) { const nx = x + dx; if (nx >= 0 && nx < this.width && !this.#cells[y * this.width + nx]) { dest = y * this.width + nx; break; } }
      if (dest >= 0) this.swap(i, dest);
      }
    }
    this.solidGravity();
    this.fractureSolids();
  }
  counts() { const result: Record<string, number> = {}; for (const t of this.#cells) if (t) result[this.materials[t].name] = (result[this.materials[t].name] || 0) + 1; return result; }
}
