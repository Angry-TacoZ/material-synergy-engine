import Phaser from 'phaser';
import { materials, M } from './simulation';
import { ParticleWorkerClient } from './particle-worker-client';
import type { ParticleInspection } from './particle-worker-protocol';
import { panBy, screenToWorld, zoomAt, type Point, type Viewport } from './demo/viewport';
import './style.css';

const CELL_SIZE = 1;
const fahrenheit = (celsius: number) => Math.round(celsius * 9 / 5 + 32);
const sim = new ParticleWorkerClient();
let latestInspection: ParticleInspection = { ticks: 0, counts: {}, reactions: {}, bodies: [], body: null, temperature: 0, material: M.Empty };
let selected = M.Sand, brush = 16, paused = false, speed = 1, erasing = false, panning = false;
let workerFailureReported = false;
let cursor = { x: 120, y: 50 }, keyboardCursor = false;
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header><a class="brand" href="./"><span class="brand-mark">◈</span> ELEMENT<span class="brand-light">SANDBOX</span></a><span class="header-note">A little world. A lot of possibilities.</span><span class="version">LOCAL EXPERIMENT / 01</span></header>
  <main>
    <div class="workspace-heading"><div><div class="eyebrow">THE PARTICLE LAB</div><h1>Matter in motion<span>.</span></h1></div><div class="live-status"><span id="status-dot"></span><span id="status">Simulation running</span></div></div>
    <div class="lab">
      <aside class="palette"><div class="panel-title">Materials <span>14</span></div><label class="search"><span>⌕</span><input id="search" type="search" placeholder="Find a material" aria-label="Find a material"></label><div class="filters" role="group" aria-label="Material categories"><button class="active" data-filter="All">All</button><button data-filter="Solids">Solids</button><button data-filter="Liquids">Liquids</button><button data-filter="Other">Other</button></div><div id="materials"></div><div class="palette-foot">Pick a material.<br>Paint something unexpected.</div></aside>
      <section class="world"><div class="world-toolbar"><div class="world-label"><span>◈</span> <span class="world-name">Workspace</span> <span class="dimensions">240 × 144</span></div><div class="toolbar-actions"><button id="zoom-out" aria-label="Zoom out" title="Zoom out">−</button><button id="zoom-reset" aria-label="Reset zoom" title="Reset zoom">100%</button><button id="zoom-in" aria-label="Zoom in" title="Zoom in">＋</button><button id="pause" aria-label="Pause simulation">Ⅱ <span>Pause</span></button><button id="step" title="Advance one simulation tick">↦ <span>Step</span></button><button id="fullscreen" aria-label="Toggle fullscreen">⛶</button></div></div><div id="game" tabindex="0" role="application" aria-label="Particle workspace. Drag to paint, or choose Pan to move a zoomed view. Mouse wheel or Zoom buttons change magnification. Arrow keys move brush; Enter paints. Space pauses."></div><div class="world-bottom"><span><i class="tiny-dot"></i> <span id="particle-count">0</span> particles</span><span id="hover-material">Move your brush to explore</span><span id="fps">60 FPS</span></div><div class="brush-tools"><div class="tool-switch"><button id="paint" class="active" aria-pressed="true">✎ Paint</button><button id="erase" aria-pressed="false">▱ Erase</button><button id="pan" aria-pressed="false">✥ Pan</button></div><label class="brush-size">Brush <input id="brush" type="range" min="1" max="28" value="8"><output id="brush-value">8</output></label><label class="speed-label">Speed <select id="speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></label><button id="clear">Clear</button></div><div class="examples"><span>TRY A SCENE</span><button data-scene="landscape">Little world <span>↗</span></button><button data-scene="fire">Lava & wood <span>↗</span></button><button data-scene="water">Cooling lava <span>↗</span></button><button data-scene="empty">Blank canvas <span>＋</span></button></div></section>
      <aside class="inspector"><div class="eyebrow">UNDER THE MICROSCOPE</div><div id="material-detail"></div><div class="tip"><span>↗</span><div><strong>Start a chain reaction</strong><p>Build with wood, add lava above it, and watch the fire spread.</p></div></div><div class="reaction-log"><div class="panel-title">Observed reactions</div><div id="reactions">Your experiments will appear here.</div></div></aside>
    </div>
    <footer><span><kbd>Drag</kbd> paint <span class="separator">/</span> <kbd>Right click</kbd> erase <span class="separator">/</span> <kbd>Wheel</kbd> or <kbd>＋</kbd><kbd>−</kbd> zoom <span class="separator">/</span> <kbd>Pan</kbd> drag view <span class="separator">/</span> <kbd>Space</kbd> pause <span class="separator">/</span> <kbd>[</kbd> <kbd>]</kbd> brush</span><span>Simplified material behavior, made for exploration.</span></footer>
  </main>`;

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
document.querySelector('.dimensions')!.textContent = `${sim.width} × ${sim.height}`;
document.querySelector('.palette .panel-title > span')!.textContent = String(materials.length - 1);
el<HTMLInputElement>('brush').max = '56'; el<HTMLInputElement>('brush').value = String(brush); el('brush-value').textContent = String(brush);
const fractureButton = document.createElement('button'); fractureButton.dataset.scene = 'fracture'; fractureButton.innerHTML = 'Break a beam <span>↗</span>'; document.querySelector('.examples')!.append(fractureButton);
const floatButton = document.createElement('button'); floatButton.dataset.scene = 'float'; floatButton.innerHTML = 'Sink or float <span>↗</span>'; document.querySelector('.examples')!.append(floatButton);
const heatButton = document.createElement('button'); heatButton.dataset.scene = 'heat'; heatButton.innerHTML = 'Heat across a gap <span>↗</span>'; document.querySelector('.examples')!.append(heatButton);
const ignitionButton = document.createElement('button'); ignitionButton.dataset.scene = 'ignite'; ignitionButton.innerHTML = 'Ignite across a gap <span>↗</span>'; document.querySelector('.examples')!.append(ignitionButton);
const tipButton = document.createElement('button'); tipButton.dataset.scene = 'tip'; tipButton.innerHTML = 'Tip a beam <span>↗</span>'; document.querySelector('.examples')!.append(tipButton);
const stressButton = document.createElement('button'); stressButton.dataset.scene = 'stress'; stressButton.innerHTML = 'Concrete stress <span>↗</span>'; document.querySelector('.examples')!.append(stressButton);
const shatterButton = document.createElement('button'); shatterButton.dataset.scene = 'shatter'; shatterButton.innerHTML = 'Shatter glass <span>↗</span>'; document.querySelector('.examples')!.append(shatterButton);
const firButton = document.createElement('button'); firButton.dataset.scene = 'fir'; firButton.innerHTML = 'Fir tree <span>↗</span>'; document.querySelector('.examples')!.append(firButton);
let filter = 'All';
function palette() {
  const query = el<HTMLInputElement>('search').value.toLowerCase();
  el('materials').innerHTML = materials.map((m, i) => ({ m, i })).filter(({ m, i }) => i && m.name.toLowerCase().includes(query) && (filter === 'All' || (filter === 'Other' ? ['Powders', 'Gases', 'Energy'].includes(m.group) : m.group === filter))).map(({ m, i }) => `<button class="material ${selected === i ? 'selected' : ''}" data-material="${i}" aria-pressed="${selected === i}"><span class="swatch" style="--material:${m.color}"></span><span>${m.name}<small>${m.state}</small></span><span class="material-symbol">${m.formula === 'Organic' ? '▤' : m.formula === 'Molten rock' ? '≈' : m.formula}</span></button>`).join('') || '<p class="empty-search">No matching materials.</p>';
  el('materials').querySelectorAll<HTMLButtonElement>('button').forEach(button => button.onclick = () => { selected = Number(button.dataset.material); setErase(false); palette(); detail(); });
}
function detail() {
  const m = materials[selected];
  el('material-detail').innerHTML = `<div class="specimen" style="--material:${m.color}"><div class="pixel-cluster"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><span>${m.formula}</span></div><div class="material-heading"><h2>${m.name}</h2><span>${m.state}</span></div><p class="description">${m.description}</p><div class="eyebrow reaction-title">WHAT HAPPENS</div><ul class="reaction-list">${m.reactions.map(r => `<li>${r}</li>`).join('')}</ul>`;
  const properties = document.createElement('div'); properties.className = 'physical-properties';
  properties.innerHTML = `<dl><div><dt>Model density</dt><dd>${m.density.toLocaleString()} kg/m³</dd></div><div><dt>Mass per cell</dt><dd>${(m.density / 1000).toFixed(3)} u</dd></div><div><dt>Brush temperature</dt><dd id="temperature-info">32 °F</dd></div></dl><p>1 u = the mass of one water cell.</p><div id="piece-info">Point at a solid to inspect its mass.</div>`;
  el('material-detail').querySelector('.description')!.after(properties);
}
function updateToolButtons() { for (const [id, active] of [['paint', !panning && !erasing], ['erase', !panning && erasing], ['pan', panning]] as const) { el(id).classList.toggle('active', active); el(id).setAttribute('aria-pressed', String(active)); } }
function setErase(value: boolean) { erasing = value; panning = false; updateToolButtons(); }
function setPause(value: boolean) { if (workerFailureReported) return; paused = value; sim.setPaused(value); el('pause').innerHTML = value ? '▶ <span>Play</span>' : 'Ⅱ <span>Pause</span>'; el('pause').setAttribute('aria-label', value ? 'Play simulation' : 'Pause simulation'); el('status').textContent = value ? 'Simulation paused' : 'Simulation running'; el('status-dot').classList.toggle('paused', value); }
el('search').oninput = palette;
document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(b => b.onclick = () => { filter = b.dataset.filter!; document.querySelectorAll('[data-filter]').forEach(x => x.classList.toggle('active', x === b)); palette(); });
el('paint').onclick = () => setErase(false); el('erase').onclick = () => setErase(true); el('pan').onclick = () => { panning = true; updateToolButtons(); };
el('pause').onclick = () => setPause(!paused);
el('step').onclick = () => { setPause(true); void sim.step().then(updateStats).catch(reportWorkerError); };
el<HTMLInputElement>('brush').oninput = e => { brush = Number((e.target as HTMLInputElement).value); el('brush-value').textContent = String(brush); };
el<HTMLSelectElement>('speed').onchange = e => { speed = Number((e.target as HTMLSelectElement).value); sim.setSpeed(speed); };
el('clear').onclick = () => { void sim.clear().then(updateStats).catch(reportWorkerError); };
document.querySelectorAll<HTMLButtonElement>('[data-scene]').forEach(b => b.onclick = () => { void sim.load(b.dataset.scene!).then(updateStats).catch(reportWorkerError); });
function fullscreen() {
  const workspace = app;
  if (workspace.classList.contains('expanded') || document.fullscreenElement) { workspace.classList.remove('expanded'); if (document.fullscreenElement) void document.exitFullscreen(); }
  else { workspace.classList.add('expanded'); el('game').focus(); void workspace.requestFullscreen().catch(() => { /* The full lab remains available when native fullscreen is blocked. */ }); }
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) app.classList.remove('expanded'); });
el('fullscreen').onclick = fullscreen;
el('game').addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') app.classList.remove('expanded');
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement) return;
  if (e.code === 'Space') { e.preventDefault(); setPause(!paused); }
  if (e.key === 'f') fullscreen();
  if (e.key === '[' || e.key === ']') { brush = Phaser.Math.Clamp(brush + (e.key === '[' ? -1 : 1), 1, 56); el<HTMLInputElement>('brush').value = String(brush); el('brush-value').textContent = String(brush); }
  if (e.key.startsWith('Arrow') && document.activeElement === el('game')) { e.preventDefault(); keyboardCursor = true; cursor.x = Phaser.Math.Clamp(cursor.x + (e.key === 'ArrowRight' ? 3 : e.key === 'ArrowLeft' ? -3 : 0), 0, sim.width - 1); cursor.y = Phaser.Math.Clamp(cursor.y + (e.key === 'ArrowDown' ? 3 : e.key === 'ArrowUp' ? -3 : 0), 0, sim.height - 1); sim.moveCursor(cursor.x, cursor.y); }
  if (e.key === 'Enter' && document.activeElement === el('game')) { e.preventDefault(); if (!panning) sim.paint(cursor.x, cursor.y, brush, erasing ? 0 : selected); }
});

function reportWorkerError(error: unknown) {
  if (workerFailureReported) return;
  workerFailureReported = true;
  paused = true;
  console.error('Particle simulation stopped:', error);
  el('status').textContent = 'Simulation unavailable · reload to restart';
  el('status-dot').classList.add('paused');
  document.querySelectorAll<HTMLButtonElement>('#paint, #erase, #pan, #pause, #step, #clear, [data-scene]').forEach(button => { button.disabled = true; });
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('#brush, #speed').forEach(control => { control.disabled = true; });
}
sim.setFailureHandler(reportWorkerError);
window.addEventListener('pagehide', () => sim.dispose(), { once: true });
async function updateStats() {
  const state = await sim.inspect(cursor.x, cursor.y);
  latestInspection = state;
  const counts = state.counts; el('particle-count').textContent = Object.values(counts).reduce((a, b) => a + b, 0).toLocaleString();
  const events = [state.reactions.ignition && `Fuel ignited · ${state.reactions.ignition}`, state.reactions.cooling && `Lava cooled · ${state.reactions.cooling}`, state.reactions.melting && `Ice melted · ${state.reactions.melting}`, state.reactions.glass && `Glass formed · ${state.reactions.glass}`, state.reactions.dissolving && `Salt dissolved · ${state.reactions.dissolving}`, state.reactions.erosion && `Cells eroded · ${state.reactions.erosion}`, state.reactions.fracture && `Concrete fractured · ${state.reactions.fracture}`].filter(Boolean);
  el('reactions').innerHTML = events.length ? events.map(v => `<p><span class="event-dot"></span>${v}</p>`).join('') : 'Your experiments will appear here.';
  const body = state.body;
  if (state.reactions.shattering) el('reactions').insertAdjacentHTML('beforeend', `<p><span class="event-dot"></span>Glass shattered · ${state.reactions.shattering}</p>`);
  el('temperature-info').textContent = `${fahrenheit(state.temperature)} °F`;
  el('piece-info').textContent = body ? `${body.material} piece · ${body.cells.toLocaleString()} cells · ${body.mass.toLocaleString(undefined, { maximumFractionDigits: 2 })} u${body.carriedMass > .001 ? ` · carrying ${body.carriedMass.toLocaleString(undefined, { maximumFractionDigits: 2 })} u` : ''}` : 'Point at a solid to inspect its mass.';
}
class SandboxScene extends Phaser.Scene {
  private texture!: Phaser.Textures.CanvasTexture;
  private outline!: Phaser.GameObjects.Graphics;
  private drawnFrame = -1;
  private lastPoint: {x: number; y: number} | null = null;
  private lastPanPoint: Point | null = null;
  private drawnTick = -1;
  private viewport: Viewport = { zoom: 1, scrollX: 0, scrollY: 0 };
  private pointerCell(point: Point) {
    const world = screenToWorld(point, this.viewport, sim.width, sim.height);
    return { x: Phaser.Math.Clamp(Math.floor(world.x), 0, sim.width - 1), y: Phaser.Math.Clamp(Math.floor(world.y), 0, sim.height - 1) };
  }
  private applyViewport() {
    this.cameras.main.setZoom(this.viewport.zoom).setScroll(this.viewport.scrollX, this.viewport.scrollY);
    el('zoom-reset').textContent = `${Math.round(this.viewport.zoom * 100)}%`;
  }
  create() {
    this.texture = this.textures.createCanvas('matter', sim.width, sim.height)!;
    this.add.image(0, 0, 'matter').setOrigin(0).setScale(CELL_SIZE);
    this.outline = this.add.graphics();
    this.input.mouse?.disableContextMenu();
    this.game.canvas.addEventListener('wheel', event => {
      event.preventDefault();
      const bounds = this.game.canvas.getBoundingClientRect();
      const point = { x: (event.clientX - bounds.left) * sim.width / bounds.width, y: (event.clientY - bounds.top) * sim.height / bounds.height };
      this.viewport = zoomAt(this.viewport, point, event.deltaY, sim.width, sim.height);
      this.applyViewport();
      this.lastPoint = null; keyboardCursor = false; cursor = this.pointerCell(point);
    }, { passive: false });
    const center = { x: sim.width / 2, y: sim.height / 2 };
    for (const [id, delta] of [['zoom-in', -462], ['zoom-out', 462]] as const) el(id).onclick = () => {
      this.viewport = zoomAt(this.viewport, center, delta, sim.width, sim.height);
      this.applyViewport(); this.lastPoint = null; this.lastPanPoint = null;
    };
    el('zoom-reset').onclick = () => { this.viewport = { zoom: 1, scrollX: 0, scrollY: 0 }; this.applyViewport(); this.lastPoint = null; cursor = this.pointerCell(this.input.activePointer); };
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { el('game').focus(); this.lastPoint = null; cursor = this.pointerCell(p); sim.moveCursor(cursor.x, cursor.y); if (panning) { this.lastPanPoint = { x: p.x, y: p.y }; return; } sim.paint(cursor.x, cursor.y, brush, erasing || p.rightButtonDown() ? 0 : selected); void updateStats().catch(reportWorkerError); });
    this.input.on('pointerup', () => { this.lastPoint = null; this.lastPanPoint = null; });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => { keyboardCursor = false; cursor = this.pointerCell(p); sim.moveCursor(cursor.x, cursor.y); });
    this.input.on('gameout', () => { this.lastPoint = null; this.lastPanPoint = null; });
    void sim.load('landscape').then(updateStats).catch(reportWorkerError);
    window.render_game_to_text = () => JSON.stringify({ coordinates: `origin top-left; x right; y down; ${sim.width}×${sim.height} cells`, simulationHz: 60, massUnits: 'one water cell = 1 u', bodies: latestInspection.bodies, paused, selected: materials[selected].name, erasing, panning, brush, speed, zoom: this.viewport.zoom, viewport: this.viewport, ticks: latestInspection.ticks, counts: latestInspection.counts, reactions: latestInspection.reactions, cursor, temperature: fahrenheit(latestInspection.temperature), temperatureUnit: '°F' });
    window.advanceTime = async (ms: number) => { await sim.advanceTime(ms); await updateStats(); };
  }
  update(_time: number, _delta: number) {
    const p = this.input.activePointer;
    if (p.isDown && p.x >= 0 && p.y >= 0 && p.x < 960 && p.y < 576 && panning) {
      const point = { x: p.x, y: p.y };
      if (this.lastPanPoint) { this.viewport = panBy(this.viewport, { x: point.x - this.lastPanPoint.x, y: point.y - this.lastPanPoint.y }, sim.width, sim.height); this.applyViewport(); }
      this.lastPanPoint = point; this.lastPoint = null; cursor = this.pointerCell(point); sim.moveCursor(cursor.x, cursor.y);
    } else if (p.isDown && p.x >= 0 && p.y >= 0 && p.x < 960 && p.y < 576) {
      const current = this.pointerCell(p);
      const previous = this.lastPoint ?? current, distance = Math.max(Math.abs(current.x - previous.x), Math.abs(current.y - previous.y), 1);
      for (let n = 0; n <= distance; n++) sim.paint(Math.round(previous.x + (current.x - previous.x) * n / distance), Math.round(previous.y + (current.y - previous.y) * n / distance), brush, erasing || p.rightButtonDown() ? 0 : selected);
      this.lastPoint = current; cursor = current; sim.moveCursor(cursor.x, cursor.y);
    } else { this.lastPoint = null; this.lastPanPoint = null; }
    if (this.drawnFrame !== sim.frameVersion) this.draw();
    if (this.game.loop.frame % 15 === 0) { void updateStats().catch(reportWorkerError); el('fps').textContent = `${Math.round(this.game.loop.actualFps)} FPS`; }
    const within = keyboardCursor || (p.x >= 0 && p.x < 960 && p.y >= 0 && p.y < 576 && this.input.manager.isOver);
    this.outline.clear();
    if (within) { if (!panning) this.outline.lineStyle(1, erasing ? 0xff9f88 : 0xe7dfbc, .7).strokeCircle(cursor.x * CELL_SIZE + CELL_SIZE / 2, cursor.y * CELL_SIZE + CELL_SIZE / 2, brush * CELL_SIZE); const t = sim.hoveredMaterial; el('hover-material').textContent = `${cursor.x}, ${cursor.y} · ${materials[t]?.name === 'Empty' ? 'Empty space' : materials[t]?.name ?? 'Loading'}`; }
  }
  draw() {
    const bitmap = sim.frame;
    if (!bitmap || this.drawnFrame === sim.frameVersion) return;
    this.drawnFrame = sim.frameVersion;
    this.texture.context.clearRect(0, 0, sim.width, sim.height);
    this.texture.context.drawImage(bitmap, 0, 0);
    this.texture.refresh();
  }
}
declare global { interface Window { render_game_to_text: () => string; advanceTime: (ms: number) => Promise<void>; } }
palette(); detail();
const game = new Phaser.Game({ type: Phaser.AUTO, width: 960, height: 576, parent: 'game', backgroundColor: '#151c20', pixelArt: true, antialias: false, scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, scene: SandboxScene, banner: false, input: { activePointers: 2 } });
new ResizeObserver(() => game.scale.refresh()).observe(el('game'));
