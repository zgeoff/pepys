export interface LatencySummary {
  readonly medianMs: number;
  readonly p99Ms: number;
  readonly maxMs: number;
}

export function buildLatencySummary(latencies: readonly number[]): LatencySummary {
  const sorted = latencies.toSorted((left, right) => left - right);

  return {
    medianMs: pickPercentile(sorted, 0.5),
    p99Ms: pickPercentile(sorted, 0.99),
    maxMs: pickPercentile(sorted, 1),
  };
}

function pickPercentile(sorted: readonly number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);

  return Math.round((sorted[Math.max(0, index)] ?? Number.NaN) * 10) / 10;
}
