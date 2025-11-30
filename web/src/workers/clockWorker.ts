// Lightweight heartbeat worker to avoid tab throttling.
// Emits current timestamp (ms) at a fixed interval.

const TICK_MS = 100;

setInterval(() => {
  // Use Date.now for wall-clock alignment.
  self.postMessage({ now: Date.now() });
}, TICK_MS);

export {};
