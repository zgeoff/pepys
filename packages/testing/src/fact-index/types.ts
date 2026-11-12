import type { FactEnvelope, FactID } from '@pepys/kit';

// One record of the test store's log: a fact in its stream, at its sequence number.
export interface LoggedFact {
  stream: string;
  seqNum: number;
  envelope: FactEnvelope<unknown>;
}

// The log in memory, with the first copy of each fact ID: the host's fact index holds one row per
// fact ID, and a module reads synchronously, so the test store keeps the index out of the database.
export interface FactIndex {
  log: readonly LoggedFact[];
  firstCopies: ReadonlyMap<FactID, LoggedFact>;
}
