/**
 * Web Worker–backed interval timer that is NOT throttled in background tabs.
 * Falls back to regular setInterval if Workers are unavailable.
 */

const workerBlob = new Blob(
  [
    `
let timers = {};
self.onmessage = function(e) {
  const { type, id, interval } = e.data;
  if (type === 'start') {
    if (timers[id]) clearInterval(timers[id]);
    timers[id] = setInterval(() => self.postMessage({ id }), interval);
  } else if (type === 'stop') {
    if (timers[id]) { clearInterval(timers[id]); delete timers[id]; }
  } else if (type === 'stopAll') {
    Object.keys(timers).forEach(k => clearInterval(timers[k]));
    timers = {};
  }
};
`,
  ],
  { type: 'application/javascript' }
);

let worker: Worker | null = null;
let nextId = 1;
const callbacks = new Map<number, () => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(URL.createObjectURL(workerBlob));
    worker.onmessage = (e) => {
      const cb = callbacks.get(e.data.id);
      if (cb) cb();
    };
    return worker;
  } catch {
    return null;
  }
}

export function setWorkerInterval(callback: () => void, interval: number): number {
  const id = nextId++;
  const w = getWorker();
  if (w) {
    callbacks.set(id, callback);
    w.postMessage({ type: 'start', id, interval });
  } else {
    // Fallback
    const handle = setInterval(callback, interval);
    callbacks.set(id, callback);
    (callbacks as any)[`_fallback_${id}`] = handle;
  }
  return id;
}

export function clearWorkerInterval(id: number): void {
  const w = getWorker();
  if (w) {
    w.postMessage({ type: 'stop', id });
  } else {
    const fallbackHandle = (callbacks as any)[`_fallback_${id}`];
    if (fallbackHandle) clearInterval(fallbackHandle);
    delete (callbacks as any)[`_fallback_${id}`];
  }
  callbacks.delete(id);
}

/**
 * One-shot variant of the worker timer.
 *
 * The combat driver paces itself against an authoritative server boundary, so
 * it needs a timer it can re-aim after every response. A repeating interval
 * cannot express that: re-arming it drifts, and leaving it running competes
 * with the re-aimed timer (the observed cause of a 2s simulation cadence
 * committing at ~2.9s). The worker is still the timing source so a backgrounded
 * tab is not throttled.
 */
export function setWorkerTimeout(callback: () => void, delay: number): number {
  const id = nextId++;
  const w = getWorker();
  const fire = () => {
    clearWorkerInterval(id);
    callback();
  };
  if (w) {
    callbacks.set(id, fire);
    w.postMessage({ type: 'start', id, interval: Math.max(0, delay) });
  } else {
    const handle = setTimeout(fire, Math.max(0, delay));
    callbacks.set(id, fire);
    (callbacks as any)[`_fallback_${id}`] = handle as unknown as number;
  }
  return id;
}

/** Cancels a pending {@link setWorkerTimeout}. */
export function clearWorkerTimeout(id: number): void {
  const w = getWorker();
  if (w) {
    w.postMessage({ type: 'stop', id });
  } else {
    const fallbackHandle = (callbacks as any)[`_fallback_${id}`];
    if (fallbackHandle) clearTimeout(fallbackHandle);
    delete (callbacks as any)[`_fallback_${id}`];
  }
  callbacks.delete(id);
}

