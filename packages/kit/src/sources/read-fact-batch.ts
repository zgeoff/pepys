import { isRecord, toTagged } from '@zgeoff/std';
import { z } from 'zod';
import { buildEventFactID } from '../facts/build-event-fact-id.ts';
import type { EntityID, StreamName } from '../ids/types.ts';
import type { Result } from '../types.ts';
import type {
  Delivery,
  FactBatchBody,
  FactFamily,
  PendingFact,
  Received,
  Sender,
  SourceContext,
} from './types.ts';

const batchFactSchema = z.strictObject({
  type: z.string().min(1),
  event: z.string().min(1),
  entity: z.string(),
  actor: z.string().optional(),
  at: z.string(),
  payload: z.unknown(),
});

const factBatchBodySchema = z.strictObject({
  v: z.literal(1),
  facts: z.array(batchFactSchema),
}) satisfies z.ZodType<FactBatchBody>;

// The read of a fact batch path. The testing package builds its envelopes with it, as ingest does.
export function readFactBatch(
  delivery: Delivery,
  source: Pick<SourceContext, 'name' | 'families'>,
): Received {
  const json = parseJSON(new TextDecoder().decode(delivery.body));

  if (!json.ok) {
    return { kind: 'refused', status: 400, reason: 'the body is not JSON' };
  }

  const body = factBatchBodySchema.safeParse(json.value);

  if (!body.success) {
    return { kind: 'refused', status: 422, reason: z.prettifyError(body.error) };
  }

  if (body.data.facts.length === 0) {
    return { kind: 'ignored' };
  }

  const facts: PendingFact[] = [];

  for (const [index, fact] of body.data.facts.entries()) {
    const built = buildPendingFact(fact, source, delivery.sender);

    if (!built.ok) {
      return { kind: 'refused', status: 422, reason: `fact ${index}: ${built.failure}` };
    }

    facts.push(built.value);
  }

  return { kind: 'batch', batch: { facts } };
}

function parseJSON(text: string): Result<unknown, null> {
  try {
    const value: unknown = JSON.parse(text);

    return { ok: true, value };
  } catch {
    return { ok: false, failure: null };
  }
}

type BatchFact = FactBatchBody['facts'][number];

function buildPendingFact(
  fact: BatchFact,
  source: Pick<SourceContext, 'name' | 'families'>,
  sender: Sender | undefined,
): Result<PendingFact, string> {
  const family = findFamily(source.families, fact.type);

  if (family === undefined) {
    return { ok: false, failure: `the source has no fact type ${fact.type}` };
  }

  if (!fact.entity.startsWith(`${family.entityKind}:`)) {
    return { ok: false, failure: `the entity is not of the kind ${family.entityKind}` };
  }

  const sent = buildSentPayload(fact.payload, sender);

  if (!sent.ok) {
    return sent;
  }

  const payload = family.types[fact.type]?.safeParse(sent.value);

  if (payload?.success !== true) {
    return { ok: false, failure: `the payload does not fit the type ${fact.type}` };
  }

  return {
    ok: true,
    value: {
      stream: toTagged<StreamName>(family.stream),
      fact: {
        id: buildEventFactID({ source: source.name, event: fact.event }),
        type: fact.type,
        v: 1,
        api: family.api,
        entity: toTagged<EntityID>(fact.entity),
        ...(fact.actor === undefined ? {} : { actor: toTagged<EntityID>(fact.actor) }),
        at: fact.at,

        // the payload as sent: a schema may strip or reshape, and the log keeps what arrived
        payload: sent.value,
      },
      blobs: [],
    },
  };
}

function findFamily(families: readonly FactFamily[], type: string): FactFamily | undefined {
  return families.find((family) => Object.hasOwn(family.types, type));
}

// On a path with a proven sender, the stored `origin` is that sender, whatever the body holds: the
// route's secret proves the batch, and only the proof says which sender wrote it.
function buildSentPayload(payload: unknown, sender: Sender | undefined): Result<unknown, string> {
  if (sender === undefined) {
    return { ok: true, value: payload };
  }

  if (!isRecord(payload)) {
    return {
      ok: false,
      failure: 'the payload is not an object, so it cannot hold the proven sender',
    };
  }

  return {
    ok: true,
    value: { ...payload, origin: { issuer: sender.issuer, subject: sender.subject } },
  };
}
