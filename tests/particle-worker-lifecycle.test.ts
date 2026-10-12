import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerParticleWorkerPagehideCleanup,
  type ParticleWorkerPagehideListener,
} from '../src/particle-worker-lifecycle.ts';

test('worker survives a persisted pagehide and is disposed on a real unload', () => {
  let disposeCount = 0;
  let pagehide: ParticleWorkerPagehideListener | undefined;

  registerParticleWorkerPagehideCleanup(() => { disposeCount++; }, listener => { pagehide = listener; });

  assert.ok(pagehide, 'the pagehide callback is installed');
  pagehide({ persisted: true });
  assert.equal(disposeCount, 0, 'a page entering the back-forward cache keeps its worker');

  pagehide({ persisted: false });
  assert.equal(disposeCount, 1, 'a non-persisted pagehide disposes the worker');
});
