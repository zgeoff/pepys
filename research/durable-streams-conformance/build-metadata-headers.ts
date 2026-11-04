import type { StreamRow } from './create-change-log.ts';
import { formatOffset } from './format-offset.ts';

export function buildMetadataHeaders(stream: StreamRow): Headers {
  const headers = new Headers({
    'content-type': stream.contentType,
    'stream-next-offset': formatOffset(stream.tail),
    'cache-control': 'no-store',
  });

  if (stream.ttlSeconds !== null) {
    headers.set('stream-ttl', String(stream.ttlSeconds));
  }

  if (stream.expiresAt !== null) {
    headers.set('stream-expires-at', stream.expiresAt);
  }

  if (stream.closed) {
    headers.set('stream-closed', 'true');
  }

  return headers;
}
