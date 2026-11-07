import { parseFactEnvelope } from '@pepys/schema';
import type { FactEnvelope } from '@pepys/schema';

// Checks the JSON a log would store, so a field that JSON drops, such as a function, cannot leave
// a stored record that fails the envelope parse on read.
export function parseStoredBody(fact: FactEnvelope<unknown>): string | null {
  let body: string;

  try {
    body = JSON.stringify(fact);
  } catch {
    return null;
  }

  const json: unknown = JSON.parse(body);

  return parseFactEnvelope(json).ok ? body : null;
}
