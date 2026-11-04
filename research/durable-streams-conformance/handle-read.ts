import { buildCursor } from './build-cursor.ts';
import { buildReadResponse } from './build-read-response.ts';
import type { Batch, StreamRow } from './create-change-log.ts';
import { formatOffset } from './format-offset.ts';
import { handleSSERead } from './handle-sse-read.ts';
import type { HandlerContext, ReadTarget } from './types.ts';

// The read side that the pepys API would serve: catch-up, long-poll and server-sent events.
export async function handleRead(
  ctx: HandlerContext,
  request: Request,
  stream: StreamRow,
): Promise<Response> {
  const url = new URL(request.url);

  const offset = parseOffset(url.searchParams);
  const live = url.searchParams.get('live');

  if (offset === null) {
    return new Response('malformed offset', { status: 400 });
  }

  if (live !== null && live !== 'long-poll' && live !== 'sse') {
    return new Response('unknown live mode', { status: 400 });
  }

  if (live !== null && !url.searchParams.has('offset')) {
    return new Response('a live read needs an offset', { status: 400 });
  }

  const target: ReadTarget = {
    ctx,
    request,
    stream,
    after: pickStartBatch(offset, stream),
    cursor: buildCursor(url.searchParams.get('cursor'), Date.now(), Math.random()),
  };

  if (live === 'sse') {
    return handleSSERead(target);
  }

  if (offset.kind === 'now' && live === null) {
    return buildReadResponse(stream, target.after, [], { cacheable: false, cursor: null });
  }

  const batches = await ctx.options.changeLog.readBatches(
    stream.streamID,
    target.after,
    ctx.options.maxChunkBytes,
  );

  if (live === null) {
    return buildCatchUpResponse(target, batches);
  }

  return handleLongPoll(target, batches);
}

const offsetPattern = /^\d{16}$/u;

type ReadOffset =
  | { readonly kind: 'start' }
  | { readonly kind: 'now' }
  | { readonly kind: 'at'; readonly batch: number };

function parseOffset(params: URLSearchParams): ReadOffset | null {
  const values = params.getAll('offset');

  if (values.length === 0) {
    return { kind: 'start' };
  }

  const [value] = values;

  if (values.length > 1 || value === undefined || value === '') {
    return null;
  }

  if (value === '-1') {
    return { kind: 'start' };
  }

  if (value === 'now') {
    return { kind: 'now' };
  }

  return offsetPattern.test(value) ? { kind: 'at', batch: Number(value) } : null;
}

function pickStartBatch(offset: ReadOffset, stream: StreamRow): number {
  if (offset.kind === 'at') {
    return offset.batch;
  }

  return offset.kind === 'now' ? stream.tail : 0;
}

// The ETag changes when the stream closes, so a client at the tail never gets a 304 that hides the
// close.
function buildCatchUpResponse(target: ReadTarget, batches: readonly Batch[]): Response {
  const end = batches.at(-1)?.batch ?? target.after;
  const closedMark = target.stream.closed && end === target.stream.tail ? ':c' : '';
  const etag = `"${target.stream.streamID}:${target.after}:${end}${closedMark}"`;

  if (target.request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { etag } });
  }

  const response = buildReadResponse(target.stream, target.after, batches, {
    cacheable: true,
    cursor: null,
  });

  response.headers.set('etag', etag);

  return response;
}

async function handleLongPoll(target: ReadTarget, batches: readonly Batch[]): Promise<Response> {
  const options = target.ctx.options;

  if (batches.length > 0) {
    return buildReadResponse(target.stream, target.after, batches, {
      cacheable: true,
      cursor: target.cursor,
    });
  }

  if (!target.stream.closed) {
    await target.ctx.waitForCommit(
      target.stream.path,
      options.longPollTimeoutMs,
      target.request.signal,
    );
  }

  const reread = await options.changeLog.readStream(target.stream.path);

  const current = reread ?? target.stream;

  const arrived = await options.changeLog.readBatches(
    current.streamID,
    target.after,
    options.maxChunkBytes,
  );

  if (arrived.length > 0) {
    return buildReadResponse(current, target.after, arrived, {
      cacheable: true,
      cursor: target.cursor,
    });
  }

  const headers = new Headers({
    'stream-next-offset': formatOffset(current.tail),
    'stream-up-to-date': 'true',
  });

  if (current.closed) {
    headers.set('stream-closed', 'true');
  } else {
    headers.set('stream-cursor', target.cursor);
  }

  return new Response(null, { status: 204, headers });
}
