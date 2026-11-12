import type { MemoryFactLog } from '@pepys/ingest';
import { toStreamName, toStreamOffset } from '@pepys/kit';
import type { CheckedDeployment, FactEnvelope, StreamName } from '@pepys/kit';
import invariant from 'tiny-invariant';
import { storeHooks } from '../test-store/store-hooks.ts';
import type { TestStore } from '../test-store/types.ts';

// The host's part for a test: the records of every stream a consumer reads go to the store as one
// batch, whole streams in the order the consumers name them. A refusal throws an ApplyError and
// moves no offset, so the next call reads the same records again.
export async function applyFactLog(
  store: TestStore,
  log: MemoryFactLog,
  deployment: CheckedDeployment,
): Promise<void> {
  const hooks = storeHooks.get(store);

  if (hooks === undefined) {
    throw new Error('the store is not the object that createTestStore returned');
  }

  const streams = new Set(deployment.consumers.flatMap((consumer) => consumer.input.streams));

  const records: { stream: StreamName; envelope: FactEnvelope<unknown> }[] = [];

  const tails = new Map<StreamName, number>();

  for (const declared of streams) {
    const stream = toStreamName(declared);
    const from = hooks.nextOffsets.get(stream) ?? 0;

    const tail = await log.readTail(stream);

    if (!tail.ok) {
      throw new Error(`the fact log has no stream ${declared}, which a consumer reads`);
    }

    if (tail.value === from) {
      continue;
    }

    const read = await log.read(stream, toStreamOffset(from), tail.value - from);

    invariant(read.ok, 'a stream with a tail can be read');

    for (const stored of read.value) {
      records.push({ stream, envelope: stored.fact });
    }

    tails.set(stream, tail.value);
  }

  await hooks.applyEnvelopes(records);

  for (const [stream, tail] of tails) {
    hooks.nextOffsets.set(stream, tail);
  }
}
