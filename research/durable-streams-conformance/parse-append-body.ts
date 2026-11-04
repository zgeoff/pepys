import { toMediaType } from './to-media-type.ts';

export type ParsedBody =
  | { readonly kind: 'data'; readonly data: Uint8Array }
  | { readonly kind: 'empty' }
  | { readonly kind: 'invalid'; readonly reason: string };

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// A JSON batch is stored as a JSON array of its messages, with one level of a posted array
// flattened. A create may hold an empty array; an append may not.
export function parseAppendBody(
  contentType: string,
  body: Uint8Array,
  isCreate: boolean,
): ParsedBody {
  if (body.length === 0) {
    return { kind: 'empty' };
  }

  if (toMediaType(contentType) !== 'application/json') {
    return { kind: 'data', data: body };
  }

  const parsed = parseJSON(textDecoder.decode(body));

  if (!parsed.ok) {
    return { kind: 'invalid', reason: 'invalid JSON' };
  }

  const messages: unknown[] = Array.isArray(parsed.value) ? parsed.value : [parsed.value];

  if (messages.length === 0) {
    return isCreate ? { kind: 'empty' } : { kind: 'invalid', reason: 'empty JSON array' };
  }

  return { kind: 'data', data: textEncoder.encode(JSON.stringify(messages)) };
}

function parseJSON(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    const value: unknown = JSON.parse(text);

    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}
