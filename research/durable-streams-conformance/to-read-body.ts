import type { Batch } from './create-change-log.ts';
import { toMediaType } from './to-media-type.ts';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// A JSON batch is stored as a JSON array, so a read joins the arrays' contents into one array.
export function toReadBody(contentType: string, batches: readonly Batch[]): Uint8Array {
  if (toMediaType(contentType) === 'application/json') {
    const inner = batches.map((batch) => textDecoder.decode(batch.data).slice(1, -1));

    return textEncoder.encode(`[${inner.join(',')}]`);
  }

  return concatBytes(batches.map((batch) => batch.data));
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);

  const joined = new Uint8Array(total);

  let position = 0;

  for (const part of parts) {
    joined.set(part, position);

    position += part.length;
  }

  return joined;
}
