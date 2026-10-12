export type ParticleWorkerPagehideEvent = Pick<PageTransitionEvent, 'persisted'>;
export type ParticleWorkerPagehideListener = (event: ParticleWorkerPagehideEvent) => void;

/** Keep the worker available for back-forward-cache restoration; dispose only on a real unload. */
export function registerParticleWorkerPagehideCleanup(
  dispose: () => void,
  register: (listener: ParticleWorkerPagehideListener) => void = listener => window.addEventListener('pagehide', listener),
) {
  register(event => {
    if (!event.persisted) dispose();
  });
}
