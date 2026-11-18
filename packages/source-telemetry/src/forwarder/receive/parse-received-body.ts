import { gunzipSync } from 'node:zlib';

export type ReceivedBody = { ok: true; body: unknown } | { ok: false };

// The JSON of a request body, after a gzip body is unpacked. A corrupt gzip body and a body that
// is no JSON both fail.
export function parseReceivedBody(bytes: Uint8Array, contentEncoding: string | null): ReceivedBody {
  try {
    const unpacked = contentEncoding?.trim().toLowerCase() === 'gzip' ? gunzipSync(bytes) : bytes;
    const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(unpacked));

    return { ok: true, body };
  } catch {
    return { ok: false };
  }
}

export function isJSONContentType(contentType: string | null): boolean {
  return contentType?.split(';')[0]?.trim().toLowerCase() === 'application/json';
}
