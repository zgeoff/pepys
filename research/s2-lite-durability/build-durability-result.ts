import { buildLatencySummary } from './build-latency-summary.ts';
import type { LatencySummary } from './build-latency-summary.ts';

export interface Acknowledgement {
  readonly recordNumber: number;
  readonly seqNum: number;
  readonly latencyMs: number;
}

export interface FailedAppend {
  readonly recordNumber: number;
  readonly startedAtMs: number;
  readonly reason: string;
}

export interface Kill {
  readonly atAttempt: number;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly recoveryMs: number;
}

export interface DurabilityLog {
  readonly acknowledgements: readonly Acknowledgement[];
  readonly failures: readonly FailedAppend[];
  readonly kills: readonly Kill[];
}

export interface StoredRecord {
  readonly seqNum: number;
  readonly body: string;
}

export interface DurabilityResult {
  readonly kills: readonly Kill[];
  readonly attempted: number;
  readonly acknowledged: number;
  readonly failed: number;
  readonly failureReasons: Readonly<Record<string, number>>;
  readonly stored: number;
  readonly gaps: number;
  readonly acknowledgedMissing: number;
  readonly acknowledgedMisplaced: number;
  readonly duplicates: number;
  readonly unknownBodies: number;
  readonly failedButStored: number;
  readonly failedStartedBeforeKill: number;
  readonly failedStartedBeforeKillButStored: number;
  readonly failedStartedDuringKill: number;
  readonly failedStartedDuringKillButStored: number;
  readonly appendLatency: LatencySummary;
}

export function buildDurabilityResult(
  log: DurabilityLog,
  stored: readonly StoredRecord[],
  killWindowMs: number,
): DurabilityResult {
  const bodyCounts = new Map<string, number>();

  for (const record of stored) {
    bodyCounts.set(record.body, (bodyCounts.get(record.body) ?? 0) + 1);
  }

  const failedNumbers = new Set(log.failures.map((failure) => String(failure.recordNumber)));
  const acknowledgedNumbers = new Set(log.acknowledgements.map((ack) => String(ack.recordNumber)));

  const startedBeforeKill = collectFailedNumbers(
    log,
    (failure, kill) =>
      failure.startedAtMs >= kill.startedAtMs - killWindowMs &&
      failure.startedAtMs < kill.startedAtMs,
  );

  const startedDuringKill = collectFailedNumbers(
    log,
    (failure, kill) =>
      failure.startedAtMs >= kill.startedAtMs && failure.startedAtMs < kill.endedAtMs,
  );

  const failureReasons: Record<string, number> = {};

  for (const failure of log.failures) {
    failureReasons[failure.reason] = (failureReasons[failure.reason] ?? 0) + 1;
  }

  return {
    kills: log.kills,
    attempted: log.acknowledgements.length + log.failures.length,
    acknowledged: log.acknowledgements.length,
    failed: log.failures.length,
    failureReasons,
    stored: stored.length,
    gaps: stored.filter((record, index) => record.seqNum !== index).length,
    acknowledgedMissing: log.acknowledgements.filter((ack) => stored[ack.seqNum] === undefined)
      .length,
    acknowledgedMisplaced: log.acknowledgements.filter((ack) => {
      const record = stored[ack.seqNum];

      return record !== undefined && record.body !== String(ack.recordNumber);
    }).length,
    duplicates: [...bodyCounts.values()].filter((count) => count > 1).length,
    unknownBodies: [...bodyCounts.keys()].filter(
      (body) => !acknowledgedNumbers.has(body) && !failedNumbers.has(body),
    ).length,
    failedButStored: [...failedNumbers].filter((body) => bodyCounts.has(body)).length,
    failedStartedBeforeKill: startedBeforeKill.length,
    failedStartedBeforeKillButStored: startedBeforeKill.filter((body) => bodyCounts.has(body))
      .length,
    failedStartedDuringKill: startedDuringKill.length,
    failedStartedDuringKillButStored: startedDuringKill.filter((body) => bodyCounts.has(body))
      .length,
    appendLatency: buildLatencySummary(log.acknowledgements.map((ack) => ack.latencyMs)),
  };
}

function collectFailedNumbers(
  log: DurabilityLog,
  isInWindow: (failure: FailedAppend, kill: Kill) => boolean,
): string[] {
  return log.failures
    .filter((failure) => log.kills.some((kill) => isInWindow(failure, kill)))
    .map((failure) => String(failure.recordNumber));
}
