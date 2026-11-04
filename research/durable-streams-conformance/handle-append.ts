import type { StreamRow } from './create-change-log.ts';
import { formatOffset } from './format-offset.ts';
import { isClosedHeader } from './is-closed-header.ts';
import { parseAppendBody } from './parse-append-body.ts';
import { toMediaType } from './to-media-type.ts';
import type { HandlerContext } from './types.ts';

// Test fixture only: the conformance suite appends with POST, where pepys's host writes the change
// log in the batch's own transaction.
export async function handleAppend(
  ctx: HandlerContext,
  request: Request,
  stream: StreamRow,
  nowMs: number,
): Promise<Response> {
  const buffer = await request.arrayBuffer();

  const body = new Uint8Array(buffer);

  const close = isClosedHeader(request.headers);
  const rejection = pickRejection(request.headers, stream, body.length, close);

  if (rejection !== null) {
    return rejection;
  }

  const seq = request.headers.get('stream-seq');
  const parsed = parseAppendBody(stream.contentType, body, false);

  if (parsed.kind === 'invalid') {
    return new Response(parsed.reason, { status: 400 });
  }

  const updated = await ctx.options.changeLog.writeAppend({
    path: stream.path,
    data: parsed.kind === 'data' ? parsed.data : null,
    close,
    seq,
    nowMs,
  });

  ctx.notifyCommit(stream.path);

  const headers = new Headers({ 'stream-next-offset': formatOffset(updated.tail) });

  if (updated.closed) {
    headers.set('stream-closed', 'true');
  }

  return new Response(null, { status: 204, headers });
}

// The protocol's precedence: a closed stream first, then the content type, then the sequence.
function pickRejection(
  headers: Headers,
  stream: StreamRow,
  bodyLength: number,
  close: boolean,
): Response | null {
  if (stream.closed) {
    const isIdempotentClose = close && bodyLength === 0;

    return new Response(null, {
      status: isIdempotentClose ? 204 : 409,
      headers: { 'stream-closed': 'true', 'stream-next-offset': formatOffset(stream.tail) },
    });
  }

  if (bodyLength === 0) {
    return close ? null : new Response('empty append', { status: 400 });
  }

  const contentType = headers.get('content-type');

  if (contentType === null) {
    return new Response('missing content type', { status: 400 });
  }

  if (toMediaType(contentType) !== toMediaType(stream.contentType)) {
    return new Response('content type mismatch', { status: 409 });
  }

  const seq = headers.get('stream-seq');

  if (seq !== null && stream.lastSeq !== null && seq <= stream.lastSeq) {
    return new Response('sequence regression', { status: 409 });
  }

  return null;
}
