import type { Batch, StreamRow } from './create-change-log.ts';
import { formatOffset } from './format-offset.ts';
import { toReadBody } from './to-read-body.ts';

export interface ReadResponseOptions {
  readonly cacheable: boolean;
  readonly cursor: string | null;
}

// Up-to-date and closed are set only when the response reaches the tail, so a partial chunk of a
// closed stream never reads as its end.
export function buildReadResponse(
  stream: StreamRow,
  after: number,
  batches: readonly Batch[],
  options: ReadResponseOptions,
): Response {
  const end = batches.at(-1)?.batch ?? Math.min(after, stream.tail);
  const isAtTail = end >= stream.tail;

  const headers = new Headers({
    'content-type': stream.contentType,
    'stream-next-offset': formatOffset(end),
    'cache-control': options.cacheable
      ? 'public, max-age=60, stale-while-revalidate=300'
      : 'no-store',
  });

  if (isAtTail) {
    headers.set('stream-up-to-date', 'true');
  }

  if (isAtTail && stream.closed) {
    headers.set('stream-closed', 'true');
  } else if (options.cursor !== null) {
    headers.set('stream-cursor', options.cursor);
  }

  return new Response(toReadBody(stream.contentType, batches), { status: 200, headers });
}
