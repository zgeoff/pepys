import { parseFactEnvelope } from '@pepys/kit';
import type { StreamOffset } from '@pepys/kit';
import invariant from 'tiny-invariant';
import type { StoredFact } from './fact-log.ts';

export function parseStoredFact(
  offset: StreamOffset,
  body: string,
  appendedAtMs: number,
): StoredFact {
  const json: unknown = JSON.parse(body);
  const fact = parseFactEnvelope(json);

  invariant(fact.ok, 'the log holds only envelopes that an append parsed');

  return { offset, fact: fact.value, body, appendedAtMs };
}
