import type { FactEnvelope } from '@pepys/kit';
import type { FactIndex, LoggedFact } from './types.ts';

interface IndexedBatch {
  index: FactIndex;

  // the batch's records, copies included, in log order
  appended: readonly LoggedFact[];
}

// The index after a batch is appended to the log. Each stream numbers its records from 0.
export function buildFactIndex(
  previous: FactIndex,
  batch: readonly { stream: string; envelope: FactEnvelope<unknown> }[],
): IndexedBatch {
  const counts = new Map<string, number>();

  for (const record of previous.log) {
    counts.set(record.stream, (counts.get(record.stream) ?? 0) + 1);
  }

  const appended = batch.map((fact) => {
    const seqNum = counts.get(fact.stream) ?? 0;

    counts.set(fact.stream, seqNum + 1);

    return { stream: fact.stream, seqNum, envelope: fact.envelope };
  });

  const firstCopies = new Map(previous.firstCopies);

  for (const record of appended) {
    if (!firstCopies.has(record.envelope.id)) {
      firstCopies.set(record.envelope.id, record);
    }
  }

  return { index: { log: [...previous.log, ...appended], firstCopies }, appended };
}
