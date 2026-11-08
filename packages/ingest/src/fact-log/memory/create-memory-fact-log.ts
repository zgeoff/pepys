import type { FactEnvelope, Result, StreamName, StreamOffset } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import type { AppendOutcome, FactLog, StoredFact } from '../fact-log.ts';
import { parseStoredBody } from '../parse-stored-body.ts';
import { parseStoredFact } from '../parse-stored-fact.ts';

export interface MemoryFactLog extends FactLog {
  // The next append is stored, and its outcome is reported as unknown, as when a reply is lost.
  loseNextReply: () => void;
}

interface MemoryRecord {
  body: string;
  appendedAtMs: number;
}

export function createMemoryFactLog(streams: readonly StreamName[]): MemoryFactLog {
  const records = new Map<StreamName, MemoryRecord[]>(streams.map((stream) => [stream, []]));

  const faults = { isReplyLost: false };

  return {
    append: (stream: StreamName, fact: FactEnvelope<unknown>, expectedTail: StreamOffset) => {
      const outcome = appendRecord(records.get(stream), fact, expectedTail);
      const isReplyLost = faults.isReplyLost && outcome.kind === 'acknowledged';

      faults.isReplyLost = false;

      const reply: AppendOutcome = isReplyLost ? { kind: 'unknown' } : outcome;

      return Promise.resolve(reply);
    },
    read: (stream: StreamName, from: StreamOffset, count: number) =>
      Promise.resolve(collectStoredFacts(records.get(stream), from, count)),
    readTail: (stream: StreamName) => Promise.resolve(getTail(records.get(stream))),
    loseNextReply: () => {
      faults.isReplyLost = true;
    },
  };
}

function appendRecord(
  stored: MemoryRecord[] | undefined,
  fact: FactEnvelope<unknown>,
  expectedTail: StreamOffset,
): AppendOutcome {
  const body = parseStoredBody(fact);

  if (body === null) {
    return { kind: 'rejected', reason: 'invalid-envelope' };
  }

  if (stored === undefined) {
    return { kind: 'rejected', reason: 'unknown-stream' };
  }

  if (expectedTail !== stored.length) {
    return { kind: 'rejected', reason: 'tail-mismatch' };
  }

  stored.push({ body, appendedAtMs: Date.now() });

  return { kind: 'acknowledged', offset: toTagged<StreamOffset>(stored.length - 1) };
}

type StreamRead<Value> = Result<Value, { reason: 'unknown-stream' }>;

function collectStoredFacts(
  stored: readonly MemoryRecord[] | undefined,
  from: StreamOffset,
  count: number,
): StreamRead<readonly StoredFact[]> {
  if (stored === undefined) {
    return { ok: false, failure: { reason: 'unknown-stream' } };
  }

  return {
    ok: true,
    value: stored
      .slice(from, from + count)
      .map((record, index) =>
        parseStoredFact(toTagged<StreamOffset>(from + index), record.body, record.appendedAtMs),
      ),
  };
}

function getTail(stored: readonly MemoryRecord[] | undefined): StreamRead<StreamOffset> {
  if (stored === undefined) {
    return { ok: false, failure: { reason: 'unknown-stream' } };
  }

  return { ok: true, value: toTagged<StreamOffset>(stored.length) };
}
