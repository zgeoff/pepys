export interface TimingSummary {
  count: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  totalMs: number;
}

export function buildTimingSummary(durationsMs: number[]): TimingSummary {
  const sorted = durationsMs.toSorted((left, right) => left - right);

  return {
    count: sorted.length,
    medianMs: pickPercentile(sorted, 0.5),
    p95Ms: pickPercentile(sorted, 0.95),
    maxMs: sorted.at(-1) ?? 0,
    totalMs: sorted.reduce((sum, durationMs) => sum + durationMs, 0),
  };
}

function pickPercentile(sorted: number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);

  return sorted[Math.max(0, index)] ?? 0;
}
