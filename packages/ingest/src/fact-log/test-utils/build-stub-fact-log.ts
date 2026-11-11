import { mock } from 'bun:test';
import type { Mock } from 'bun:test';
import type { StreamOffset } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import type { AppendBatchOutcome, FactLog } from '../fact-log.ts';

interface StubFactLog extends FactLog {
  appendBatch: Mock<FactLog['appendBatch']>;
}

// A log whose every append gives the same outcome, on a stream whose tail stays at 0.
export function buildStubFactLog(outcome: AppendBatchOutcome): StubFactLog {
  return {
    appendBatch: mock<FactLog['appendBatch']>(() => Promise.resolve(outcome)),
    read: () => Promise.resolve({ ok: true, value: [] }),
    readTail: () => Promise.resolve({ ok: true, value: toTagged<StreamOffset>(0) }),
  };
}
