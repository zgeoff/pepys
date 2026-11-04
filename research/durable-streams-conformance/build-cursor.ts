const cursorEpochMs = Date.UTC(2024, 9, 9);
const cursorIntervalMs = 20_000;
const maxJitterIntervals = 180;

// The cursor is the 20-second interval number since the protocol's epoch. A cursor the client
// echoes from the current interval or later moves forward by a random jitter, so it never repeats.
export function buildCursor(echoed: string | null, nowMs: number, random: number): string {
  const interval = Math.floor((nowMs - cursorEpochMs) / cursorIntervalMs);
  const echoedInterval = echoed !== null && /^\d+$/u.test(echoed) ? Number(echoed) : null;

  if (echoedInterval === null || echoedInterval < interval) {
    return String(interval);
  }

  return String(echoedInterval + 1 + Math.floor(random * maxJitterIntervals));
}
