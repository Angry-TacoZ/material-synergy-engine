import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ParticleWorkerClient,
  type ParticleWorkerTransport,
} from '../src/particle-worker-client.ts';
import type { ParticleWorkerCommand, ParticleWorkerMessage } from '../src/particle-worker-protocol.ts';

class FakeWorker implements ParticleWorkerTransport {
  sent: ParticleWorkerCommand[] = [];
  terminated = false;
  private messageHandler: ((message: ParticleWorkerMessage) => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private messageErrorHandler: ((error: Error) => void) | null = null;

  postMessage(message: ParticleWorkerCommand) { this.sent.push(message); }
  onMessage(handler: (message: ParticleWorkerMessage) => void) { this.messageHandler = handler; }
  onError(handler: (error: Error) => void) { this.errorHandler = handler; }
  onMessageError(handler: (error: Error) => void) { this.messageErrorHandler = handler; }
  terminate() { this.terminated = true; }
  emit(message: ParticleWorkerMessage) { this.messageHandler?.(message); }
  emitError(error: Error) { this.errorHandler?.(error); }
  emitMessageError(error: Error) { this.messageErrorHandler?.(error); }
}

function createClient(options: ConstructorParameters<typeof ParticleWorkerClient>[0] = {}) {
  const worker = new FakeWorker();
  const errors: Error[] = [];
  const client = new ParticleWorkerClient({ ...options, createWorker: () => worker });
  client.setFailureHandler(error => errors.push(error));
  return { client, worker, errors };
}

function acknowledge(worker: FakeWorker, command: ParticleWorkerCommand) {
  assert.ok('id' in command);
  worker.emit({ type: 'ack', id: command.id });
}

test('worker input waits for ready, batches paint points, and keeps the latest cursor', async () => {
  const { client, worker } = createClient();
  client.paint(1, 2, 3, 4);
  client.paint(2, 2, 3, 4);
  client.paint(3, 2, 3, 5);
  client.moveCursor(7, 8);
  client.moveCursor(9, 10);
  await Promise.resolve();

  assert.equal(worker.sent.length, 0, 'commands wait until the worker completes its handshake');
  worker.emit({ type: 'ready' });
  assert.equal(worker.sent.length, 1, 'many input calls become one worker message');
  const input = worker.sent[0];
  assert.equal(input.type, 'input');
  if (input.type !== 'input') throw new Error('Expected an input batch.');
  assert.deepEqual(input.strokes, [
    { radius: 3, material: 4, points: [{ x: 1, y: 2 }, { x: 2, y: 2 }] },
    { radius: 3, material: 5, points: [{ x: 3, y: 2 }] },
  ]);
  assert.deepEqual(input.cursor, { x: 9, y: 10 });

  acknowledge(worker, input);
  assert.equal(client.state, 'ready');
  client.dispose();
});

test('paint batches stay ordered before clear while only one command is in flight', async () => {
  const { client, worker } = createClient();
  worker.emit({ type: 'ready' });
  client.paint(10, 10, 2, 4);
  await Promise.resolve();
  client.paint(11, 10, 2, 4);
  const clear = client.clear();
  await Promise.resolve();

  assert.deepEqual(worker.sent.map(message => message.type), ['input']);
  const first = worker.sent[0];
  acknowledge(worker, first);
  assert.deepEqual(worker.sent.map(message => message.type), ['input', 'input']);
  const second = worker.sent[1];
  acknowledge(worker, second);
  assert.deepEqual(worker.sent.map(message => message.type), ['input', 'input', 'clear']);
  acknowledge(worker, worker.sent[2]);
  await clear;
  client.dispose();
});

test('worker transport failure rejects active and queued commands and stops future input', async () => {
  const { client, worker, errors } = createClient();
  worker.emit({ type: 'ready' });
  const first = assert.rejects(client.clear(), /worker crashed/);
  const second = assert.rejects(client.step(), /worker crashed/);
  assert.equal(worker.sent.length, 1);

  worker.emitError(new Error('worker crashed'));
  await Promise.all([first, second]);
  assert.equal(client.state, 'failed');
  assert.equal(worker.terminated, true);
  assert.equal(errors.length, 1);
  client.paint(1, 1, 1, 2);
  assert.equal(worker.sent.length, 1, 'failed clients do not keep posting input');
  await assert.rejects(client.clear(), /worker crashed/);
  client.dispose();
});

test('a missing command acknowledgement fails the worker instead of queueing forever', async () => {
  const { client, worker } = createClient({ operationTimeoutMs: 5 });
  worker.emit({ type: 'ready' });
  const result = assert.rejects(client.clear(), /did not acknowledge clear/);
  await result;
  assert.equal(client.state, 'failed');
  assert.equal(worker.terminated, true);
  client.dispose();
});

test('worker startup failure and missing ready handshake are reported and fail closed', async () => {
  const startupErrors: Error[] = [];
  const unavailable = new ParticleWorkerClient({ createWorker: () => { throw new Error('Worker is unavailable'); } });
  unavailable.setFailureHandler(error => startupErrors.push(error));
  assert.equal(unavailable.state, 'failed');
  assert.equal(startupErrors.length, 1);
  await assert.rejects(unavailable.load('landscape'), /Worker is unavailable/);
  unavailable.dispose();

  const { client, worker, errors } = createClient({ readyTimeoutMs: 5 });
  await new Promise<void>(resolve => {
    client.setFailureHandler(error => { errors.push(error); resolve(); });
  });
  assert.equal(client.state, 'failed');
  assert.equal(worker.terminated, true);
  assert.match(errors[0].message, /did not become ready/);
  client.dispose();
});

test('paint backlog overflow is visible and never silently drops accepted paint', async () => {
  const { client, worker, errors } = createClient({ maxQueuedPaintPoints: 2 });
  worker.emit({ type: 'ready' });
  client.paint(1, 1, 1, 2);
  client.paint(2, 1, 1, 2);
  client.paint(3, 1, 1, 2);
  await Promise.resolve();

  assert.equal(client.state, 'failed');
  assert.equal(worker.terminated, true);
  assert.match(errors[0].message, /paint input queue exceeded/);
  assert.equal(worker.sent.length, 0, 'overflow stops the session instead of sending a partial stroke');
  client.dispose();
});

test('out-of-order worker responses are treated as a protocol failure', async () => {
  const { client, worker, errors } = createClient();
  worker.emit({ type: 'ready' });
  const result = assert.rejects(client.clear(), /did not match the in-flight operation/);
  worker.emit({ type: 'ack', id: 999 });
  await result;
  assert.equal(client.state, 'failed');
  assert.equal(worker.terminated, true);
  assert.equal(errors.length, 1);
  client.dispose();
});
