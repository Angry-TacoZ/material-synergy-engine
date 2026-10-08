import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { chromium } from 'file:///C:/Users/angry/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright/index.mjs';

const root = process.cwd();
const outDir = resolve(root, 'output/performance');
const runFile = resolve(outDir, process.env.MSE_BENCH_RUN_FILE ?? 'four-way-runs-20261008-final.jsonl');
const resourceFile = resolve(outDir, process.env.MSE_RESOURCE_FILE ?? 'four-way-resource-samples-20261008-final.jsonl');
const environmentFile = resolve(outDir, 'four-way-environment-20261008.json');
const profileDir = process.env.MSE_CHROME_PROFILE ?? 'C:\\Users\\angry\\AppData\\Local\\Temp\\mse-four-way-bench-profile-20261008';
const resourceMonitorScript = resolve(outDir, 'monitor-chrome-resources.ps1');
const durationMs = Number(process.env.MSE_BENCH_SECONDS ?? 60) * 1000;
const warmupMs = Number(process.env.MSE_BENCH_WARMUP_SECONDS ?? 5) * 1000;
const repetitions = Number(process.env.MSE_BENCH_REPETITIONS ?? 3);
const smoke = process.env.MSE_BENCH_SMOKE === '1';
const resume = process.env.MSE_BENCH_RESUME === '1';
const onlyConfigIds = process.env.MSE_BENCH_CONFIGS?.split(',').filter(Boolean);
const configs = [
  { id: 'A', name: 'Baseline', commit: 'e32546a130b93288ca67bf427f035d5aff70d9ff', url: 'http://127.0.0.1:5181/' },
  { id: 'B', name: 'CPU', commit: '89d3c9fbd62b95bd4d7102bd71e020b93186407a', url: 'http://127.0.0.1:5182/' },
  { id: 'C', name: 'Worker', commit: '6fdbcc915ef61cfc42d2358e3cd8a6a6df6bfd01', url: 'http://127.0.0.1:5183/' },
  { id: 'D', name: 'Combined', commit: '8edf80c802050502acfa84ca14f9154ea9b51566', url: 'http://127.0.0.1:5184/' },
];

const line = (y, start, end, step) => Array.from({ length: Math.floor((end - start) / step) + 1 }, (_, i) => [start + i * step, y]);
const workloads = [
  { id: 'empty', title: 'Blank canvas', preset: 'empty' },
  { id: 'landscape', title: 'Little world', preset: 'landscape' },
  { id: 'fracture', title: 'Break a beam', preset: 'fracture' },
  { id: 'fir', title: 'Fir tree', preset: 'fir' },
  { id: 'fire', title: 'Lava & wood', preset: 'fire' },
  { id: 'water', title: 'Cooling lava', preset: 'water' },
  { id: 'float', title: 'Sink or float / dense liquids', preset: 'float' },
  { id: 'heat', title: 'Heat across a gap', preset: 'heat' },
  { id: 'ignite', title: 'Ignite across a gap', preset: 'ignite' },
  { id: 'tip', title: 'Tip a beam', preset: 'tip' },
  { id: 'stress', title: 'Concrete stress / connected structure', preset: 'stress' },
  { id: 'shatter', title: 'Shatter glass / falling debris', preset: 'shatter' },
  { id: 'stress-dense-liquids', title: 'Stress: dense liquids', setup: [
    ['Water', 25, [...line(380, 70, 890, 55), ...line(430, 70, 890, 55), ...line(480, 70, 890, 55), ...line(530, 70, 890, 55)]],
  ] },
  { id: 'stress-connected-structure', title: 'Stress: large connected structure', setup: [
    ['Concrete', 18, [...line(355, 120, 840, 28), ...line(470, 355, 495, 18), ...line(840, 355, 495, 18), ...line(420, 420, 550, 26)]],
  ] },
  { id: 'stress-fragmentation', title: 'Stress: structural fragmentation and falling debris', setup: [
    ['Concrete', 18, line(545, 100, 860, 28)],
    ['Glass', 22, [...line(265, 260, 695, 38), ...line(300, 300, 660, 38)]],
  ] },
  { id: 'stress-combustion', title: 'Stress: extensive combustion', setup: [
    ['Stone', 18, line(540, 100, 860, 34)],
    ['Wood', 20, [...line(430, 130, 830, 38), ...line(470, 130, 830, 38), ...line(510, 130, 830, 38)]],
    ['Lava', 10, [[160, 400], [205, 400], [250, 400], [295, 400]]],
  ] },
  { id: 'stress-vapor', title: 'Stress: active steam and smoke', setup: [
    ['Stone', 16, line(535, 140, 820, 38)],
    ['Water', 22, [...line(500, 240, 450, 40), ...line(500, 510, 800, 50)]],
    ['Lava', 14, [[280, 500], [500, 480], [720, 500]]],
    ['Wood', 14, [[150, 480], [190, 480], [850, 480]]],
  ] },
  { id: 'stress-reactions', title: 'Stress: simultaneous material reactions', setup: [
    ['Stone', 12, [[115, 530], [335, 530], [555, 530], [775, 530]]],
    ['Wood', 14, [[155, 420], [195, 420], [330, 300], [370, 300]]],
    ['Lava', 9, [[155, 393], [370, 273], [555, 500], [775, 500]]],
    ['Water', 13, [[330, 420], [370, 420], [595, 500]]],
    ['Salt', 8, [[370, 420], [610, 480]]],
    ['Ice', 12, [[720, 420], [790, 420]]],
    ['Acid', 8, [[115, 500], [335, 500]]],
    ['Concrete', 10, [[115, 480], [335, 480]]],
  ] },
];

function hookSource() {
  const metrics = {
    active: false, intervals: [], lastRaf: null, rafCount: 0, worldUpdates: 0,
    workerFrames: 0, workerInstances: 0, latestWorkerTicks: -1, latestWorkerInspectionTicks: -1, latestWorkerInspectionAt: null, latestWorkerRevision: -1,
    contexts: [], pending: new Map(), requestDelays: [], inputStart: null,
    inputVisibleMs: null, inputPostMs: null, uiStart: null, uiLatencyMs: null,
    heapSamples: [], gcEntries: [], worldContextId: null,
  };
  window.__msePerf = metrics;
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (...args) {
    const context = originalGetContext.apply(this, args);
    if (context && this.width === 960 && this.height === 576 && args[0] === '2d' && !context.__msePerfEntry) {
      const entry = { id: metrics.contexts.length, context, canvas: this, put: 0, draw: 0, putStack: '', drawStack: '', order: metrics.contexts.length };
      context.__msePerfEntry = entry;
      metrics.contexts.push(entry);
      const put = context.putImageData.bind(context);
      const draw = context.drawImage.bind(context);
      context.putImageData = (...values) => {
        entry.put++;
        if (!entry.putStack) entry.putStack = new Error().stack || '';
        if (metrics.active && entry.id === metrics.worldContextId && metrics.worldMethod === 'put') {
          metrics.worldUpdates++;
          if (metrics.inputStart !== null && metrics.inputVisibleMs === null) metrics.inputVisibleMs = performance.now() - metrics.inputStart;
        }
        return put(...values);
      };
      context.drawImage = (...values) => {
        entry.draw++;
        if (!entry.drawStack) entry.drawStack = new Error().stack || '';
        if (metrics.active && entry.id === metrics.worldContextId && metrics.worldMethod === 'draw') {
          metrics.worldUpdates++;
          if (metrics.inputStart !== null && metrics.inputVisibleMs === null) metrics.inputVisibleMs = performance.now() - metrics.inputStart;
        }
        return draw(...values);
      };
    }
    return context;
  };
  document.addEventListener('pointerdown', event => {
    if (event.target instanceof HTMLCanvasElement && event.target.parentElement?.id === 'game') {
      metrics.inputStart = performance.now(); metrics.inputVisibleMs = null; metrics.inputPostMs = null;
      metrics.inputRevision = metrics.latestWorkerRevision;
    }
  }, true);
  document.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('#pause')) metrics.uiStart = performance.now();
  }, true);
  const observePause = () => {
    const button = document.querySelector('#pause');
    if (!button || button.__mseObserved) return;
    button.__mseObserved = true;
    new MutationObserver(() => {
      if (metrics.uiStart !== null && metrics.uiLatencyMs === null) {
        const started = metrics.uiStart;
        requestAnimationFrame(() => { if (metrics.uiLatencyMs === null) metrics.uiLatencyMs = performance.now() - started; });
      }
    }).observe(button, { attributes: true, attributeFilter: ['aria-label'] });
  };
  new MutationObserver(observePause).observe(document, { childList: true, subtree: true });
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      metrics.workerInstances++;
      const originalPost = this.postMessage.bind(this);
      this.postMessage = (message, transfer) => {
        const sentAt = performance.now();
        if (message && typeof message.id === 'number') metrics.pending.set(message.id, { type: message.type, sentAt });
        if (message?.type === 'paint' && metrics.inputStart !== null && metrics.inputPostMs === null) metrics.inputPostMs = sentAt - metrics.inputStart;
        return transfer === undefined ? originalPost(message) : originalPost(message, transfer);
      };
      this.addEventListener('message', event => {
        const message = event.data;
        if (message?.type === 'frame') {
          metrics.latestWorkerTicks = message.ticks;
          metrics.latestWorkerRevision = message.revision;
          if (metrics.active) metrics.workerFrames++;
        } else if (message?.type === 'inspection') {
          metrics.latestWorkerTicks = message.value.ticks;
          metrics.latestWorkerInspectionTicks = message.value.ticks;
          metrics.latestWorkerInspectionAt = performance.now();
        }
        if (message && typeof message.id === 'number' && metrics.pending.has(message.id)) {
          const posted = metrics.pending.get(message.id); metrics.pending.delete(message.id);
          if (metrics.active) metrics.requestDelays.push({ type: posted.type, ms: performance.now() - posted.sentAt });
        }
      });
    }
  };
  window.__msePerfBegin = () => {
    metrics.active = true; metrics.intervals = []; metrics.lastRaf = null; metrics.rafCount = 0;
    metrics.worldUpdates = 0; metrics.workerFrames = 0; metrics.requestDelays = [];
    metrics.heapSamples = []; metrics.gcEntries = [];
    metrics.startTicks = JSON.parse(window.render_game_to_text()).ticks;
    metrics.startPerf = performance.now();
    metrics.startRevision = metrics.latestWorkerRevision;
    const collect = now => {
      if (!metrics.active) return;
      if (metrics.lastRaf !== null) metrics.intervals.push(now - metrics.lastRaf);
      metrics.lastRaf = now; metrics.rafCount++;
      if (performance.memory && (metrics.heapSampleAt === undefined || now - metrics.heapSampleAt >= 1000)) {
        metrics.heapSamples.push(performance.memory.usedJSHeapSize); metrics.heapSampleAt = now;
      }
      requestAnimationFrame(collect);
    };
    requestAnimationFrame(collect);
  };
  window.__msePerfEnd = (sampleEnd = {}) => {
    metrics.active = false;
    const endPerf = sampleEnd.endPerf ?? performance.now();
    const state = sampleEnd.state ?? JSON.parse(window.render_game_to_text());
    const intervals = [...metrics.intervals].sort((a, b) => a - b);
    const percentile = q => intervals.length ? intervals[Math.min(intervals.length - 1, Math.floor(intervals.length * q))] : null;
    const tickEnd = Number.isInteger(state.ticks) ? state.ticks : metrics.latestWorkerTicks;
    const contexts = metrics.contexts.map(c => ({ id: c.id, connected: c.canvas.isConnected, put: c.put, draw: c.draw, putStack: c.putStack.split('\n').slice(0, 4), drawStack: c.drawStack.split('\n').slice(0, 4) }));
    return {
      elapsedMs: endPerf - metrics.startPerf,
      displayFrames: metrics.rafCount,
      displayFps: metrics.rafCount * 1000 / (endPerf - metrics.startPerf),
      intervals: { p95Ms: percentile(.95), p99Ms: percentile(.99), maxMs: intervals.at(-1) ?? null,
        over33ms: metrics.intervals.filter(v => v > 33).length, total: metrics.intervals.length },
      simulationTicks: tickEnd - metrics.startTicks,
      startTicks: metrics.startTicks,
      endTicks: tickEnd,
      simulationTps: (tickEnd - metrics.startTicks) * 1000 / (endPerf - metrics.startPerf),
      simulationSecondsPerWallSecond: (tickEnd - metrics.startTicks) / 60 / ((endPerf - metrics.startPerf) / 1000),
      uniqueWorldFrameUpdates: metrics.worldUpdates,
      uniqueWorldFrameFps: metrics.worldUpdates * 1000 / (endPerf - metrics.startPerf),
      workerFrameMessages: metrics.workerFrames,
      latestWorkerInspectionTicks: metrics.latestWorkerInspectionTicks,
      latestWorkerInspectionAt: metrics.latestWorkerInspectionAt,
      workerRequestDelaysMs: metrics.requestDelays.map(x => x.ms),
      heapSamplesBytes: metrics.heapSamples,
      gcEntries: metrics.gcEntries,
      contexts, state,
      worldContextId: metrics.worldContextId,
      worldMethod: metrics.worldMethod,
      inputLatencyMs: metrics.inputVisibleMs,
      inputToWorkerPostMs: metrics.inputPostMs,
      uiLatencyMs: metrics.uiLatencyMs,
    };
  };
  try {
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) metrics.gcEntries.push({ startTime: entry.startTime, duration: entry.duration, kind: entry.detail?.kind ?? null });
    });
    if (PerformanceObserver.supportedEntryTypes?.includes('gc')) observer.observe({ type: 'gc', buffered: true });
    metrics.gcSupported = PerformanceObserver.supportedEntryTypes?.includes('gc') ?? false;
  } catch { metrics.gcSupported = false; }
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function p95(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))];
}
async function selectMaterial(page, name) {
  await page.locator('#materials .material').evaluateAll((buttons, materialName) => {
    const button = buttons.find(x => x.textContent.trim().toLowerCase().startsWith(materialName.toLowerCase()));
    if (!button) throw new Error(`Material not found in palette: ${materialName}`);
    button.click();
  }, name);
}
async function setBrush(page, radius) {
  await page.locator('#brush').evaluate((input, value) => {
    input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
  }, radius);
}
async function paintSequence(page, name, radius, points) {
  await selectMaterial(page, name); await setBrush(page, radius);
  const bounds = await page.locator('#game canvas').boundingBox();
  const state = JSON.parse(await page.evaluate(() => window.render_game_to_text()));
  const dims = state.coordinates.match(/(\d+)×(\d+)/);
  const width = Number(dims[1]), height = Number(dims[2]);
  for (const [x, y] of points) await page.mouse.click(bounds.x + x / width * bounds.width, bounds.y + y / height * bounds.height);
}
async function prepare(page, workload) {
  await page.locator('#pause').click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).paused);
  if (workload.preset) {
    const previousRevision = await page.evaluate(() => window.__msePerf.latestWorkerRevision);
    await page.locator(`[data-scene="${workload.preset}"]`).click();
    if (previousRevision >= 0) await page.waitForFunction(previous => window.__msePerf.latestWorkerRevision > previous, previousRevision);
  } else {
    const previousRevision = await page.evaluate(() => window.__msePerf.latestWorkerRevision);
    await page.locator('[data-scene="empty"]').click();
    if (previousRevision >= 0) await page.waitForFunction(previous => window.__msePerf.latestWorkerRevision > previous, previousRevision);
    const emptyRevision = await page.evaluate(() => window.__msePerf.latestWorkerRevision);
    for (const [material, radius, points] of workload.setup) await paintSequence(page, material, radius, points);
    if (emptyRevision >= 0) await page.waitForFunction(previous => window.__msePerf.latestWorkerRevision > previous, emptyRevision);
    await page.waitForTimeout(750);
  }
}
async function identifyWorldContext(page, config) {
  return await page.evaluate(id => {
    const m = window.__msePerf;
    const appStack = stack => /\.draw\s*\(/i.test(stack);
    const candidates = m.contexts.filter(c => appStack(c.putStack) || appStack(c.drawStack)).sort((a, b) => a.order - b.order);
    const selected = candidates[0] ?? null;
    m.worldContextId = selected?.id ?? null;
    m.worldMethod = id === 'C' || id === 'D' ? 'draw' : 'put';
    return { worldContextId: m.worldContextId, worldMethod: m.worldMethod, candidates: candidates.map(c => ({ id: c.id, put: c.put, draw: c.draw, putStack: c.putStack.split('\n').slice(0, 4), drawStack: c.drawStack.split('\n').slice(0, 4) })) };
  }, config.id);
}
async function readCDPMetrics(session) {
  const response = await session.send('Performance.getMetrics');
  const picked = Object.fromEntries(response.metrics.filter(m => ['JSHeapUsedSize','JSHeapTotalSize','TaskDuration','ScriptDuration','ThreadTime','Nodes','JSEventListeners'].includes(m.name)).map(m => [m.name, m.value]));
  return picked;
}

await mkdir(outDir, { recursive: true });
let completed = new Set();
if (resume) {
  try { completed = new Set((await readFile(runFile, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(line => { const r = JSON.parse(line); return `${r.repetition}:${r.configuration}:${r.workload}`; })); } catch {}
} else {
  try { await readFile(runFile); throw new Error(`Refusing to overwrite ${runFile}; set MSE_BENCH_RESUME=1 to continue it.`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

const context = await chromium.launchPersistentContext(profileDir, {
  channel: 'chrome', headless: false,
  viewport: { width: 1600, height: 1000 }, screen: { width: 1600, height: 1000 }, deviceScaleFactor: 1,
  args: ['--no-first-run', '--no-default-browser-check'],
});
let resourceMonitor = null;
try {
  const finder = `$target='${profileDir.replaceAll("'", "''")}'; Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like ('*' + $target + '*') -and $_.CommandLine -notmatch '--type=' } | Select-Object -First 1 -ExpandProperty ProcessId`;
  const finderOutput = execFileSync('powershell.exe', ['-NoProfile', '-Command', finder], { encoding: 'utf8' }).trim();
  const chromePid = Number(finderOutput);
  if (Number.isInteger(chromePid) && chromePid > 0 && process.env.MSE_RESOURCE_MONITOR !== '0') {
    const monitorStdout = openSync(resolve(outDir, 'four-way-resource-monitor-20261008.stdout.log'), 'a');
    const monitorStderr = openSync(resolve(outDir, 'four-way-resource-monitor-20261008.stderr.log'), 'a');
    const sourceText = await readFile(resourceMonitorScript, 'utf8');
    const bodyStart = sourceText.indexOf('$ErrorActionPreference');
    if (bodyStart < 0) throw new Error('Resource-monitor body marker is missing.');
    const source = sourceText.slice(bodyStart);
    const psCommand = `& { param([int]$RootPid, [string]$OutputPath, [int]$IntervalSeconds); ${source} } -RootPid ${chromePid} -OutputPath '${resourceFile.replaceAll("'", "''")}' -IntervalSeconds ${Number(process.env.MSE_RESOURCE_INTERVAL_SECONDS ?? 10)}`;
    const encodedCommand = Buffer.from(psCommand, 'utf16le').toString('base64');
    resourceMonitor = spawn('powershell.exe', ['-NoProfile', '-EncodedCommand', encodedCommand], { stdio: ['ignore', monitorStdout, monitorStderr], windowsHide: true });
    resourceMonitor.on('error', error => console.warn(`Resource monitor launch error: ${String(error)}`));
    resourceMonitor.on('close', code => console.log(`Resource monitor exited code=${code}`));
    resourceMonitor.unref();
    console.log(`Resource monitor started for Chrome PID ${chromePid}; samples=${resourceFile}`);
  } else console.warn(`Resource monitor root PID unavailable (finder output: ${finderOutput || 'empty'})`);
} catch (error) { console.warn(`Resource monitor unavailable: ${String(error)}`); }
const page = context.pages()[0] ?? await context.newPage();
await page.setViewportSize({ width: 1600, height: 1000 });
await page.addInitScript(hookSource);
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error)));
page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) pageErrors.push(`${message.text()} @ ${message.location().url}`); });
page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) pageErrors.push(`HTTP ${response.status()} ${response.url()}`); });
let browserInfo, gpuInfo;
{
  const session = await context.browser().newBrowserCDPSession();
  browserInfo = await session.send('Browser.getVersion');
  gpuInfo = await session.send('SystemInfo.getInfo').catch(error => ({ error: String(error) }));
  await session.detach();
}
const onlyWorkloads = process.env.MSE_BENCH_WORKLOADS?.split(',').filter(Boolean);
const activeWorkloads = onlyWorkloads ? workloads.filter(w => onlyWorkloads.includes(w.id)) : workloads;
if (onlyWorkloads && activeWorkloads.length !== onlyWorkloads.length) throw new Error('Unknown workload id in MSE_BENCH_WORKLOADS.');
const activeConfigs = onlyConfigIds ? configs.filter(c => onlyConfigIds.includes(c.id)) : configs;
if (onlyConfigIds && activeConfigs.length !== onlyConfigIds.length) throw new Error('Unknown configuration id in MSE_BENCH_CONFIGS.');
const environment = {
  createdAt: new Date().toISOString(), os: `${os.type()} ${os.release()} ${os.arch()}`,
  cpu: os.cpus()[0]?.model, logicalProcessors: os.cpus().length,
  chrome: browserInfo, gpu: gpuInfo.gpu ?? gpuInfo,
  viewport: { width: 1600, height: 1000, deviceScaleFactor: 1, browserZoom: '100% default profile', renderer: 'headed installed Chrome', hardwareAcceleration: gpuInfo.gpu?.featureStatus ?? 'not reported' },
  resolution: '960×576 simulation cells and 960×576 render target', durationSeconds: durationMs / 1000,
  warmupSeconds: warmupMs / 1000, repetitions, workloads: activeWorkloads.map(x => ({ id: x.id, title: x.title })),
  configurations: activeConfigs.map(({ id, name, commit, url }) => ({ id, name, commit, url })),
  instrumentation: 'One requestAnimationFrame sampler; low-overhead CanvasTexture context and Worker message counters; the app inspection API refreshes completed physics ticks at each sample boundary; profile captures are separate.',
};
await writeFile(environmentFile, JSON.stringify(environment, null, 2));

let repetitionsToRun = smoke ? 1 : repetitions;
if (smoke) repetitionsToRun = 1;

for (let repetition = 1; repetition <= repetitionsToRun; repetition++) {
  for (let wi = 0; wi < activeWorkloads.length; wi++) {
    const workload = activeWorkloads[wi];
    const startIndex = (repetition - 1 + wi) % activeConfigs.length;
    const configOrder = [...activeConfigs.slice(startIndex), ...activeConfigs.slice(0, startIndex)];
    for (const config of configOrder) {
      const key = `${repetition}:${config.id}:${workload.id}`;
      if (completed.has(key)) { console.log(`SKIP ${key}`); continue; }
      pageErrors.length = 0;
      const runStartedAt = new Date().toISOString();
      await page.goto(config.url, { waitUntil: 'load' });
      await page.waitForFunction(() => typeof window.render_game_to_text === 'function' && window.__msePerf);
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.waitForFunction((usesWorker) => !usesWorker || window.__msePerf.latestWorkerTicks >= 0, config.id === 'C' || config.id === 'D');
      await prepare(page, workload);
      await page.locator('#pause').click();
      await delay(warmupMs);
      await page.goto(config.url, { waitUntil: 'load' });
      await page.waitForFunction(() => typeof window.render_game_to_text === 'function' && window.__msePerf);
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.waitForFunction((usesWorker) => !usesWorker || window.__msePerf.latestWorkerTicks >= 0, config.id === 'C' || config.id === 'D');
      await prepare(page, workload);
      // Flush queued scene/paint commands and refresh the inspection while paused.
      await page.evaluate(() => window.advanceTime(0));
      const worldHook = await identifyWorldContext(page, config);
      const gcSupported = await page.evaluate(() => window.__msePerf.gcSupported);
      const hookProbe = await page.evaluate(() => ({ begin: typeof window.__msePerfBegin, end: typeof window.__msePerfEnd, metricKeys: Object.keys(window.__msePerf ?? {}) }));
      if (hookProbe.begin !== 'function' || hookProbe.end !== 'function') throw new Error(`Performance hook init failed: ${JSON.stringify({ hookProbe, pageErrors })}`);
      const stateBefore = JSON.parse(await page.evaluate(() => window.render_game_to_text()));
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      const heapStart = await readCDPMetrics(cdp);
      const nodeStart = performance.now();
      await page.evaluate(() => window.__msePerfBegin());
      await page.locator('#pause').click();
      const measurementStartedAt = new Date().toISOString();
      await delay(durationMs);
      const nodeEnd = performance.now();
      const measured = await page.evaluate(async () => {
        // Read live physics state through the app's normal inspection path before ending the sample.
        await window.advanceTime(0);
        const state = JSON.parse(window.render_game_to_text());
        const endPerf = performance.now();
        return window.__msePerfEnd({ state, endPerf });
      });
      const measurementEndedAt = new Date().toISOString();
      const heapEnd = await readCDPMetrics(cdp);
      await cdp.detach();
      const beforeCounts = stateBefore.counts ?? {};
      const afterCounts = measured.state.counts ?? {};

      // One real pointer action after the timed sample measures paint-to-render while the workload remains active.
      await page.evaluate(() => { const m = window.__msePerf; m.active = true; m.inputStart = null; m.inputVisibleMs = null; m.inputPostMs = null; m.uiLatencyMs = null; });
      const bounds = await page.locator('#game canvas').boundingBox();
      await page.mouse.click(bounds.x + bounds.width * .08, bounds.y + bounds.height * .08);
      await page.waitForFunction(() => window.__msePerf.inputVisibleMs !== null, undefined, { timeout: 5000 }).catch(() => {});
      const inputLatency = await page.evaluate(() => ({ visibleMs: window.__msePerf.inputVisibleMs, postMs: window.__msePerf.inputPostMs }));
      await page.locator('#pause').click().catch(() => {});
      const uiLatency = await page.evaluate(() => window.__msePerf.uiLatencyMs);
      await page.evaluate(() => { window.__msePerf.active = false; });

      const record = {
        repetition, configuration: config.id, commit: config.commit, workload: workload.id, workloadTitle: workload.title,
        runStartedAt, runEndedAt: new Date().toISOString(), durationTargetMs: durationMs, warmupMs,
        measurementStartedAt, measurementEndedAt, startWorldTicks: stateBefore.ticks,
        actualElapsedMs: measured.elapsedMs, nodeElapsedMs: nodeEnd - nodeStart,
        displayFps: measured.displayFps, displayFrameCallbacks: measured.displayFrames,
        frameIntervals: measured.intervals,
        simulationTicks: measured.simulationTicks, simulationTps: measured.simulationTps,
        startSimulationTicks: measured.startTicks, endSimulationTicks: measured.endTicks,
        simulatedSecondsPerWallSecond: measured.simulationSecondsPerWallSecond,
        uniqueWorldFramesUploaded: measured.uniqueWorldFrameUpdates, uniqueWorldFrameFps: measured.uniqueWorldFrameFps,
        workerFramesReceived: measured.workerFrameMessages,
        workerRequestDelayMs: measured.workerRequestDelaysMs,
        paintingInputLatencyMs: inputLatency.visibleMs, inputToWorkerPostMs: inputLatency.postMs,
        uiPauseResponseMs: uiLatency,
        worldHook, gcSupported, gcEntries: measured.gcEntries,
        heapSamplesBytes: measured.heapSamplesBytes, cdMetricsStart: heapStart, cdMetricsEnd: heapEnd,
        startCounts: beforeCounts, endCounts: afterCounts, endReactions: measured.state.reactions,
        errors: [...pageErrors],
      };
      await appendFile(runFile, JSON.stringify(record) + '\n');
      completed.add(key);
      console.log(`DONE rep=${repetition} config=${config.id} workload=${workload.id} display=${measured.displayFps.toFixed(1)} tps=${measured.simulationTps.toFixed(1)} world=${measured.uniqueWorldFrameFps.toFixed(1)} p95=${measured.intervals.p95Ms?.toFixed(1)}ms`);
    }
  }
}
await context.close();
resourceMonitor?.kill();
console.log(`COMPLETE results=${runFile} environment=${environmentFile}`);
