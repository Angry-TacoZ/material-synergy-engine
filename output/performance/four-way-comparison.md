# Four-Way Particle Lab Performance Comparison

## Result

**D (combined CPU indexes + worker compositor) had the strongest display/throughput balance in this reduced sample. It did not meet a true 60 Hz simulation-and-world-update target on Lava & wood or Sink or float.** B had the highest equal-weight mean physics rate and world-image update rate, but its main-thread display fell to 24 FPS on Lava & wood and 23 FPS on Sink or float. The worker configurations kept the display callback near 60 FPS while their world images updated much less often.

**PR #4 is not safe to merge as-is.** Normal API replays matched exactly, but a focused reproduction found a tick-1 physics regression when callers write directly to the public `Simulation.cells` typed array. PR #4's new occupancy bitmap does not observe that write. Do not merge PR #4 or PR #5 based on this report.

## Tested revisions and environment

| Config | Implementation | Commit |
|---|---|---|
| A | Original baseline | `e32546a130b93288ca67bf427f035d5aff70d9ff` |
| B | PR #4 CPU bitmap/index changes | `89d3c9fbd62b95bd4d7102bd71e020b93186407a` |
| C | PR #5 worker/compositor | `6fdbcc915ef61cfc42d2358e3cd8a6a6df6bfd01` |
| D | PR #4 changes integrated into PR #5 | `8edf80c802050502acfa84ca14f9154ea9b51566` |

All four revisions share baseline `e32546a130b93288ca67bf427f035d5aff70d9ff` as their common ancestor. D was constructed on a temporary branch from C by cherry-picking B; it applied cleanly. Each configuration used its own worktree and production build.

The short comparison ran on Windows 11, an Intel i9-13900KF (32 logical processors), NVIDIA RTX 4090, and headed Chrome 154.0.8037.93 through ANGLE/D3D11 with GPU compositing enabled. The viewport was 1600×1000 at 100% zoom and device scale 1; the simulation and render target remained 960×576. No simulation rules, material definitions, or visual effects were reduced.

## Method

The matrix contains 32 completed runs: four configurations × four scenes × two repetitions. Each run measured 15 seconds after a 5-second warmup. Runs were sequential in one headed Chrome session; configuration order rotated by scene and repetition. Every run began at simulation tick 0 and lasted 15.05–15.24 seconds. There were no browser errors.

The measured physics rate is the actual completed tick delta divided by elapsed time, refreshed through the app inspection path at the sample boundary. Display FPS counts main-page `requestAnimationFrame` callbacks. World frames/s counts world-image canvas updates observed by the harness; it is an upload/update proxy, not a physical compositor scanout or a pixel-content uniqueness test. The displayed p95 is the mean of the two per-run p95 frame intervals, not a p95 pooled from raw intervals.

The reduced comparison excludes three valid but incompatible 60-second blank-canvas rows from the interrupted original matrix. Those rows are preserved as supplemental data; a 60-second result was not mixed into the required 15-second, two-repetition sample. The earlier precorrected run file is also preserved and excluded because its worker tick reading could lag live state.

## Results

Each cell below is the mean of two runs. “World updates/s” is the canvas update proxy defined above.

| Scene | Config | Physics ticks/s | World updates/s | Display FPS | Mean run p95 (ms) |
|---|---:|---:|---:|---:|---:|
| Blank canvas | A | 59.8 | 59.8 | 59.9 | 16.8 |
| Blank canvas | B | 59.3 | 59.3 | 59.5 | 16.8 |
| Blank canvas | C | 59.8 | 55.0 | 59.9 | 16.8 |
| Blank canvas | D | 59.8 | 57.3 | 59.9 | 16.8 |
| Lava & wood | A | 45.3 | 23.5 | 23.7 | 91.8 |
| Lava & wood | B | 47.0 | 31.9 | 32.0 | 83.4 |
| Lava & wood | C | 44.3 | 15.1 | 59.6 | 16.8 |
| Lava & wood | D | 46.9 | 22.1 | 59.9 | 16.8 |
| Sink or float | A | 43.9 | 19.0 | 19.2 | 66.8 |
| Sink or float | B | 52.7 | 22.4 | 22.5 | 66.8 |
| Sink or float | C | 42.2 | 14.1 | 60.0 | 16.8 |
| Sink or float | D | 50.2 | 16.7 | 59.8 | 16.8 |
| Concrete stress | A | 59.1 | 48.1 | 48.3 | 33.5 |
| Concrete stress | B | 59.7 | 59.2 | 59.4 | 16.8 |
| Concrete stress | C | 58.0 | 30.3 | 60.0 | 16.8 |
| Concrete stress | D | 59.8 | 49.1 | 59.5 | 16.8 |

The following means weight the four scenes equally. Percentages compare with A; a positive p95 change means a lower interval.

| Config | Physics ticks/s (change) | World updates/s (change) | Display FPS (change) | Mean run p95 (improvement) |
|---|---:|---:|---:|---:|
| A | 52.0 | 37.6 | 37.8 | 52.2 ms |
| B | 54.7 (+5.2%) | 43.2 (+14.9%) | 43.3 (+14.7%) | 46.0 ms (+12.0%) |
| C | 51.1 (−1.8%) | 28.6 (−23.8%) | 59.9 (+58.5%) | 16.8 ms (+67.8%) |
| D | 54.2 (+4.1%) | 36.3 (−3.4%) | 59.8 (+58.3%) | 16.8 ms (+67.8%) |

D improved the display loop and p95 over B while retaining nearly B's mean physics throughput, but B produced more world-image updates overall. D's image-update rate fell to 22.1/s in Lava & wood and 16.7/s in Sink or float while its display loop stayed near 60 callbacks/s. A smooth display callback therefore did not mean that a new simulated world image arrived at 60 Hz. No configuration sustained 60 physics ticks/s and 60 world-image updates/s across the heat and liquid scenes.

## Correctness and merge safety

The existing `npm run verify` results were reused; no 88–90-test suite was rerun. All four revisions had passed their prior suite, type-check, and production build: A/C had 88 passing tests, B/D had 90, with zero test failures. The production builds emitted the existing large-bundle advisory.

A focused direct-engine replay used seed 42, 960×576 worlds, and 120 ticks each for Blank canvas, Lava & wood, Sink or float, and Concrete stress. It compared cell/material positions, lifetimes, movement flags, UVs, thermal and ignition state, RNG, counters, solid membership/body state, and revisions. A/B, A/C, A/D, and B/D had zero initial or later differences in all four scenes. PR #4's occupancy and ignition bitmaps also matched recomputed indexes at tick 0 and every 30 ticks. This establishes agreement for these scenes when mutations use the normal engine APIs; it does not cover every material or every worker message path.

The separate public-array reproduction did fail: with a 32×32 world, writing Sand to `sim.cells[80]` directly and stepping gives A position 112 on tick 1; B leaves it at 80. After eight ticks A is at 336 and B remains at 80. `Simulation.cells` is a public writable typed array, and the existing simulation test suite also uses `s.cells.fill(M.Stone)` to set up a case. The application itself had no direct cell writes outside the engine in the inspected source, but library callers can bypass the new index. This makes PR #4 unsafe to merge until the public mutation contract and index synchronization are resolved and covered by a regression test.

The replay validates the engine state, not browser pixel equivalence. This reduced scope did not capture matching screenshots or exhaustively exercise worker pause/step/clear/failure paths. The app smoke runs had no errors, but visual raster fidelity and worker capability fallback remain unverified.

## Remaining gaps and next action

This is a short, four-scene comparison, not the original 12-preset and six-stress workload. Two 15-second samples per cell can miss longer stalls; the single supplemental 60-second blank-canvas rows already show that the interval tails can differ. Per-process CPU, GPU, memory, and garbage-collection comparisons were not collected in the reduced run. The Phaser display callback metric is not physical scanout, and the image-update hook is an update proxy.

**Recommendation:** D is the strongest measured balance to investigate further, but it still falls short of 60 Hz physics and world-image updates in the two heavy scenes. Do not merge either PR from this experiment. Keep PR #4 blocked on the direct-mutation regression. For PR #5, retain the worker branch for review only; this short run shows smoother display callbacks but not 60 new world frames/s, and does not establish pixel fidelity or a fallback path.

The report, raw runs, summary, environment, interrupted long-run rows, smoke artifacts, and scripts are preserved under `output/performance/`. To reproduce, start the four production previews at ports 5181–5184 from the four worktrees, then run:

```powershell
$env:MSE_BENCH_SECONDS = '15'
$env:MSE_BENCH_WARMUP_SECONDS = '5'
$env:MSE_BENCH_REPETITIONS = '2'
$env:MSE_BENCH_WORKLOADS = 'empty,fire,float,stress'
$env:MSE_BENCH_RUN_FILE = 'four-way-short-rerun.jsonl'
$env:MSE_RESOURCE_MONITOR = '0'
node output/performance/four-way-browser-bench.mjs
node output/performance/four-way-short-summary.mjs output/performance/four-way-short-rerun.jsonl output/performance/four-way-short-rerun-summary.json
```

For the selected-scene exact-state replay, set `MSE_REPLAY_WORKLOADS='empty,fire,float,stress'` and run `node --import tsx output/performance/four-way-deterministic-replay.mjs`. The direct-mutation reproduction is `node --import tsx output/performance/four-way-public-cell-mutation-repro.mjs`.
