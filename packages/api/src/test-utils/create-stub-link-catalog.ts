import { implement } from '@orpc/server';
import { coreContract } from '@pepys/contract';
import type { FactLog, StoredFact } from '@pepys/ingest';
import { buildManualFactID, isEntityOfKind } from '@pepys/schema';
import type {
  ConsumerLink,
  EntityID,
  LinkEnds,
  LinkRegistryOf,
  LinkTypeDeclaration,
  StreamName,
  StreamOffset,
} from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { match } from 'ts-pattern';
import { z } from 'zod';
import type { Principal } from '../principal/principal.ts';

export function createStubLinkCatalog(log: FactLog, stream: StreamName) {
  const api = implement(coreContract).$context<{ principal: Principal }>();

  return {
    assert_link: api.assert_link.handler(async (options) => {
      const fact = buildManualFactID(options.context.principal.client, options.input.requestID);

      await log.append(stream, {
        id: fact,
        type: 'link.asserted',
        v: 1,
        api: 'pepys/1',
        entity: options.input.from,
        at: '2026-10-01T08:00:00Z',
        payload: {
          action: 'assert',
          type: options.input.type,
          from: options.input.from,
          to: options.input.to.kind === 'entity' ? options.input.to.id : '',
          confidence: options.input.confidence,
          evidence: options.input.evidence,
        },
      });

      return { fact };
    }),
    retract_link: api.retract_link.handler(async (options) => {
      const fact = buildManualFactID(options.context.principal.client, options.input.requestID);

      await log.append(stream, {
        id: fact,
        type: 'link.retracted',
        v: 1,
        api: 'pepys/1',
        entity: options.input.from,
        at: '2026-10-01T09:00:00Z',
        payload: {
          action: 'retract',
          type: options.input.type,
          from: options.input.from,
          to: options.input.to.kind === 'entity' ? options.input.to.id : '',
          confidence: 0,
          evidence: options.input.reason,
        },
      });

      return { fact };
    }),
    neighbourhood: api.neighbourhood.handler(async (options) => {
      const read = await log.read(stream, toTagged<StreamOffset>(0), 100);

      invariant(read.ok, 'the stub catalog reads a stream the log holds');

      return {
        entities: [],
        links: collectEffectiveLinks(read.value)
          .filter((link) => link.from === options.input.id)
          .filter((link) => link.confidence >= options.input.minimumConfidence)
          .map((link) => ({
            type: link.type,
            from: link.from,
            to: link.to,
            confidence: link.confidence,
            direction: 'outgoing' as const,
            depth: 1,
          })),
      };
    }),
  };
}

type Registry = LinkRegistryOf<LinkTypeDeclaration<'mentions', 'gmail:msg', 'github:issue'>>;

const linkPayloadSchema = z.object({
  action: z.enum(['assert', 'retract']),
  type: z.literal('mentions'),
  from: z.string().transform((text) => toTagged<EntityID>(text)),
  to: z.string().transform((text) => toTagged<EntityID>(text)),
  confidence: z.number(),
  evidence: z.string(),
});

function collectEffectiveLinks(stored: readonly StoredFact[]): ConsumerLink<Registry>[] {
  const links = new Map<string, ConsumerLink<Registry>>();

  for (const entry of stored) {
    const payload = linkPayloadSchema.parse(entry.fact.payload);

    invariant(
      isEntityOfKind(payload.from, ['gmail:msg']) && isEntityOfKind(payload.to, ['github:issue']),
      'the stub catalog stores mentions links from a message to an issue',
    );

    const ends: LinkEnds<Registry> = {
      type: payload.type,
      from: payload.from,
      to: { kind: 'entity', id: payload.to },
    };

    const key = JSON.stringify(ends);

    match(payload.action)
      .with('assert', () =>
        links.set(key, { ...ends, confidence: payload.confidence, evidence: payload.evidence }),
      )
      .with('retract', () => links.delete(key))
      .exhaustive();
  }

  return [...links.values()];
}
