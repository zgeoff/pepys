import type { FactEnvelope, StreamName } from '@pepys/kit';
import type { TestStore } from './types.ts';

export interface StoreHooks {
  // Runs the consumers on the records as one batch in one transaction. A refusal throws an
  // ApplyError, and the batch then writes nothing.
  applyEnvelopes: (
    records: readonly { stream: string; envelope: FactEnvelope<unknown> }[],
  ) => Promise<void>;

  // the offset of the next record to apply from a fact log, by stream
  nextOffsets: Map<StreamName, number>;
}

// What a test store gives the package's own functions and keeps out of its public type.
export const storeHooks = new WeakMap<TestStore, StoreHooks>();
