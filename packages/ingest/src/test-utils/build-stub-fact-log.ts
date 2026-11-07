import { mock } from 'bun:test';
import type { Mock } from 'bun:test';
import type { StreamOffset } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import type { AppendOutcome, FactLog } from '../fact-log/fact-log.ts';

interface StubFactLog extends FactLog {
  append: Mock<FactLog['append']>;
}

// A log whose every append gives the same outcome, on a stream whose tail stays at 0.
export function buildStubFactLog(outcome: AppendOutcome): StubFactLog {
  return {
    append: mock<FactLog['append']>(() => Promise.resolve(outcome)),
    read: () => Promise.resolve({ ok: true, value: [] }),
    readTail: () => Promise.resolve({ ok: true, value: toTagged<StreamOffset>(0) }),
  };
}
