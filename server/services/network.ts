import { setTimeout } from 'node:timers/promises';

export type Fetch = typeof globalThis.fetch;
export type Throttle = () => Promise<void>;

// Shared by providers so batch OMDb and Wikidata calls together stay ~1 req/s.
export function createThrottle(interval = 1000): Throttle {
  let last = 0;
  let queue = Promise.resolve();
  return () => {
    const next = queue.then(async () => {
      const wait = interval - (Date.now() - last);
      if (wait > 0) await setTimeout(wait);
      last = Date.now();
    });
    queue = next.catch(() => {});
    return next;
  };
}

export class UpstreamError extends Error {
  statusCode = 502;
}
