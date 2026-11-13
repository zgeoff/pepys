import type { Result, StreamName, StreamOffset } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import type { FactLog, StoredFact } from './fact-log.ts';

// A read can end before `count` records, so it repeats from the next offset until it has them all
// or the stream ends.
export async function readRun(
  log: FactLog,
  stream: StreamName,
  from: StreamOffset,
  count: number,
): Promise<Result<readonly StoredFact[], { reason: 'unknown-stream' }>> {
  const records: StoredFact[] = [];

  while (records.length < count) {
    const read = await log.read(
      stream,
      toTagged<StreamOffset>(from + records.length),
      count - records.length,
    );

    if (!read.ok) {
      return read;
    }

    if (read.value.length === 0) {
      break;
    }

    records.push(...read.value);
  }

  return { ok: true, value: records };
}
