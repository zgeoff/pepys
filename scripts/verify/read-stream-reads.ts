import type { StreamClient } from '@wringer/stream';
import { collectStreamReads } from './collect-stream-reads.ts';
import type { StreamLogLine, StreamReadRecord } from './collect-stream-reads.ts';

// The host's reads of one fact stream since `use` marked the `s2` stream, from s2-lite's log.
export async function readStreamReads(
  streams: StreamClient,
  stream: string,
): Promise<{ reads: StreamReadRecord[] }> {
  const lines: StreamLogLine[] = [];

  let slice = await streams.read({ name: 's2' });

  lines.push(...slice.records);

  while (slice.more) {
    slice = await streams.read({ name: 's2', from: slice.cursor });

    lines.push(...slice.records);
  }

  return { reads: collectStreamReads(lines, stream) };
}
