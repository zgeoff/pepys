import type { FactEnvelope, Result, StreamName, StreamOffset } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { checkAppendBatch } from '../../utils/check-append-batch.ts';
import type { AppendBatchOutcome, FactLog, StoredFact } from '../fact-log.ts';
import { parseStoredFact } from '../parse-stored-fact.ts';

interface OtherWriter {
  thenAppend: readonly FactEnvelope<unknown>[];
}

export interface MemoryFactLog extends FactLog {
  // The next append is stored whole, and its outcome is reported as unknown.
  loseNextReply: () => void;

  // The next append is not stored and its outcome is reported as unknown. Then `thenAppend` is
  // stored at the tail, as a second writer on the stream would store it.
  dropNextAppend: (other: OtherWriter) => void;

  // The next append reports unknown and is not stored yet. It is stored, whole, just before the
  // append after it is checked, so that one gets a tail mismatch.
  landNextAppendLate: () => void;
}

interface MemoryRecord {
  body: string;
  appendedAtMs: number;
}

type Fault =
  | { kind: 'lose-reply' }
  | { kind: 'drop'; thenAppend: readonly FactEnvelope<unknown>[] }
  | { kind: 'land-late' };

interface LateAppend {
  stream: StreamName;
  bodies: readonly string[];
}

interface MemoryState {
  records: Map<StreamName, MemoryRecord[]>;
  fault: Fault | null;
  late: LateAppend | null;
}

export function createMemoryFactLog(streams: readonly StreamName[]): MemoryFactLog {
  const state: MemoryState = {
    records: new Map(streams.map((stream) => [stream, []])),
    fault: null,
    late: null,
  };

  return {
    appendBatch: (stream, facts, expectedTail) =>
      Promise.resolve(appendBatch(state, stream, facts, expectedTail)),
    read: (stream, from, count) =>
      Promise.resolve(collectStoredFacts(state.records.get(stream), from, count)),
    readTail: (stream) => Promise.resolve(getTail(state.records.get(stream))),
    loseNextReply: () => {
      state.fault = { kind: 'lose-reply' };
    },
    dropNextAppend: (other) => {
      state.fault = { kind: 'drop', thenAppend: other.thenAppend };
    },
    landNextAppendLate: () => {
      state.fault = { kind: 'land-late' };
    },
  };
}

function appendBatch(
  state: MemoryState,
  stream: StreamName,
  facts: readonly FactEnvelope<unknown>[],
  expectedTail: StreamOffset,
): AppendBatchOutcome {
  landLateAppend(state);

  const fault = state.fault;

  state.fault = null;

  const checked = checkAppendBatch(facts);

  if (!checked.ok) {
    return { kind: 'rejected', ...checked.failure };
  }

  const stored = state.records.get(stream);

  if (stored === undefined) {
    return { kind: 'rejected', reason: 'unknown-stream' };
  }

  if (expectedTail !== stored.length) {
    return { kind: 'rejected', reason: 'tail-mismatch' };
  }

  if (fault?.kind === 'drop') {
    pushOtherWriter(stored, fault.thenAppend);

    return { kind: 'unknown' };
  }

  if (fault?.kind === 'land-late') {
    state.late = { stream, bodies: checked.value };

    return { kind: 'unknown' };
  }

  pushBodies(stored, checked.value);

  return fault === null
    ? { kind: 'acknowledged', firstOffset: expectedTail, count: checked.value.length }
    : { kind: 'unknown' };
}

// The append stays valid until it lands: nothing is stored between its refusal of a reply and the
// next call, so the tail is still the one it aimed at.
function landLateAppend(state: MemoryState): void {
  const late = state.late;

  state.late = null;

  const stored = late === null ? undefined : state.records.get(late.stream);

  if (late !== null && stored !== undefined) {
    pushBodies(stored, late.bodies);
  }
}

function pushBodies(stored: MemoryRecord[], bodies: readonly string[]): void {
  const appendedAtMs = Date.now();

  for (const body of bodies) {
    stored.push({ body, appendedAtMs });
  }
}

function pushOtherWriter(stored: MemoryRecord[], facts: readonly FactEnvelope<unknown>[]): void {
  const checked = checkAppendBatch(facts);

  invariant(checked.ok, 'the facts of a second writer pass the append checks');
  pushBodies(stored, checked.value);
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
