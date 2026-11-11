import { parseFactEnvelope, readFactBatch } from '@pepys/kit';
import type { FactEnvelope, Result, SourceDefinition } from '@pepys/kit';
import type { ApplyFailure } from '../utils/types.ts';
import type { ApplyOptions } from './types.ts';

interface AppliedEnvelope {
  stream: string;
  envelope: FactEnvelope<unknown>;
}

// The facts of one apply as ingest would store them: the fact batch read builds each envelope, and
// the envelope parser checks it.
export function parseAppliedFacts(
  source: SourceDefinition,
  facts: readonly { payload: unknown }[],
  sender: ApplyOptions['sender'],
): Result<AppliedEnvelope[], ApplyFailure> {
  const withOrigin = facts.map((fact) =>
    sender === undefined || !isObject(fact.payload)
      ? fact
      : {
          ...fact,
          payload: { ...fact.payload, origin: { issuer: sender.issuer, subject: sender.subject } },
        },
  );

  const received = readFactBatch(
    {
      headers: new Headers(),
      body: new TextEncoder().encode(JSON.stringify({ v: 1, facts: withOrigin })),
    },
    { name: source.name, families: source.families },
  );

  if (received.kind === 'refused') {
    return refuseFacts(received.reason);
  }

  if (received.kind === 'ignored') {
    return { ok: true, value: [] };
  }

  const envelopes: AppliedEnvelope[] = [];

  for (const pending of received.batch.facts) {
    const parsed = parseFactEnvelope(pending.fact);

    if (!parsed.ok) {
      return refuseFacts(parsed.failure.issues.map((issue) => issue.message).join('; '));
    }

    envelopes.push({ stream: pending.stream, envelope: parsed.value });
  }

  return { ok: true, value: envelopes };
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function refuseFacts(reason: string): Result<AppliedEnvelope[], ApplyFailure> {
  return { ok: false, failure: { kind: 'refused-facts', reason } };
}
