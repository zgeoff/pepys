export interface HistoryProbe {
  readonly at: string;
  readonly httpStatus: 200 | 404;
}

export interface HistoryState {
  readonly historyID: string;
  readonly storedAt: string;
  readonly probes: readonly HistoryProbe[];
}

export interface HistoryVerdict {
  readonly storedAt: string;
  readonly probeCount: number;
  readonly lastValidAgeHours: number | null;
  readonly firstExpiredAgeHours: number | null;
}

// The history ID's lifetime lies between the last 200 before the first 404 and that 404.
export function buildHistoryVerdict(state: HistoryState): HistoryVerdict {
  const storedMs = Date.parse(state.storedAt);
  const firstExpiredIndex = state.probes.findIndex((probe) => probe.httpStatus === 404);

  const probesBeforeExpiry =
    firstExpiredIndex === -1 ? state.probes : state.probes.slice(0, firstExpiredIndex);

  const lastValid = probesBeforeExpiry.findLast((probe) => probe.httpStatus === 200);
  const firstExpired = firstExpiredIndex === -1 ? undefined : state.probes[firstExpiredIndex];

  return {
    storedAt: state.storedAt,
    probeCount: state.probes.length,
    lastValidAgeHours: lastValid === undefined ? null : toAgeHours(lastValid.at, storedMs),
    firstExpiredAgeHours: firstExpired === undefined ? null : toAgeHours(firstExpired.at, storedMs),
  };
}

const hourMs = 3_600_000;

function toAgeHours(at: string, storedMs: number): number {
  return Math.round(((Date.parse(at) - storedMs) / hourMs) * 10) / 10;
}
