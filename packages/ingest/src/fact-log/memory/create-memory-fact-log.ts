import type { FactEnvelope, Result, StreamName, StreamOffset } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import type { AppendOutcome, FactLog, StoredFact } from '../fact-log.ts';

export function createMemoryFactLog(streams: readonly StreamName[]): FactLog {
  const facts = new Map<StreamName, StoredFact[]>(streams.map((stream) => [stream, []]));

  return {
    append: (stream: StreamName, fact: FactEnvelope<unknown>) =>
      Promise.resolve(appendFact(facts.get(stream), fact)),
    read: (stream: StreamName, from: StreamOffset, count: number) =>
      Promise.resolve(collectStoredFacts(facts.get(stream), from, count)),
    readTail: (stream: StreamName) => Promise.resolve(getTail(facts.get(stream))),
  };
}

function appendFact(stored: StoredFact[] | undefined, fact: FactEnvelope<unknown>): AppendOutcome {
  if (stored === undefined) {
    return { kind: 'rejected', reason: 'unknown-stream' };
  }

  const offset = toTagged<StreamOffset>(stored.length);

  stored.push({ offset, fact });

  return { kind: 'acknowledged', offset };
}

type StreamRead<Value> = Result<Value, { reason: 'unknown-stream' }>;

function collectStoredFacts(
  stored: readonly StoredFact[] | undefined,
  from: StreamOffset,
  count: number,
): StreamRead<readonly StoredFact[]> {
  if (stored === undefined) {
    return { ok: false, failure: { reason: 'unknown-stream' } };
  }

  return { ok: true, value: stored.slice(from, from + count) };
}

function getTail(stored: readonly StoredFact[] | undefined): StreamRead<StreamOffset> {
  if (stored === undefined) {
    return { ok: false, failure: { reason: 'unknown-stream' } };
  }

  return { ok: true, value: toTagged<StreamOffset>(stored.length) };
}
