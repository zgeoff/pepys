import { expect, test } from 'bun:test';
import { createRouterClient, implement } from '@orpc/server';
import { coreContract } from '@pepys/contract';
import { createMemoryFactLog } from '@pepys/ingest';
import { buildManualFactID, isEntityOfKind } from '@pepys/schema';
import type {
  ClientID,
  ConsumerOutcome,
  EntityID,
  FactInput,
  FactOperation,
  GrantID,
  LinkRegistryOf,
  LinkTypeDeclaration,
  StreamName,
  StreamOffset,
} from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { z } from 'zod';
import type { Principal } from '../src/principal/principal.ts';

function setupTest() {
  type Registry = LinkRegistryOf<LinkTypeDeclaration<'mentions', 'gmail:msg', 'github:issue'>>;

  type LinkOperation = FactOperation<never, Registry>;

  const stream = toTagged<StreamName>('facts.manual.link');
  const log = createMemoryFactLog([stream]);

  const linkPayloadSchema = z.object({
    action: z.enum(['assert', 'retract']),
    type: z.literal('mentions'),
    from: z.string().transform((text) => toTagged<EntityID>(text)),
    to: z.string().transform((text) => toTagged<EntityID>(text)),
    confidence: z.number(),
    evidence: z.string(),
    client: z.string(),
  });

  const manualLinks = (input: FactInput): ConsumerOutcome<LinkOperation> => {
    const payload = linkPayloadSchema.parse(input.fact.payload);

    if (
      !isEntityOfKind(payload.from, ['gmail:msg']) ||
      !isEntityOfKind(payload.to, ['github:issue'])
    ) {
      return { rejected: 'a mentions link runs from a message to an issue' };
    }

    const ends = {
      type: payload.type,
      from: payload.from,
      to: { kind: 'entity', id: payload.to },
    } as const;

    const operation: LinkOperation =
      payload.action === 'assert'
        ? { link: { ...ends, confidence: payload.confidence, evidence: payload.evidence } }
        : { unlink: ends };

    return { applied: [operation] };
  };

  const api = implement(coreContract).$context<{ principal: Principal }>();

  const router = {
    assert_link: api.assert_link.handler(async (options) => {
      const fact = buildManualFactID(options.context.principal.client, options.input.requestID);

      const outcome = await log.append(stream, {
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
          client: options.context.principal.client,
        },
      });

      invariant(outcome.kind === 'acknowledged', 'the memory log acknowledges an append');

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
          client: options.context.principal.client,
        },
      });

      return { fact };
    }),
    neighbourhood: api.neighbourhood.handler(async (options) => {
      const read = await log.read(stream, toTagged<StreamOffset>(0), 100);

      invariant(read.ok, 'the memory log holds the manual link stream');

      const links = new Map<string, Extract<LinkOperation, { link: unknown }>['link']>();

      for (const stored of read.value) {
        const outcome = manualLinks({ mode: 'fact', offset: stored.offset, fact: stored.fact });

        invariant('applied' in outcome, 'the trace writes only links the registry allows');

        for (const operation of outcome.applied) {
          if ('link' in operation) {
            const ends = [operation.link.type, operation.link.from, operation.link.to];

            links.set(JSON.stringify(ends), operation.link);
          } else if ('unlink' in operation) {
            const ends = [operation.unlink.type, operation.unlink.from, operation.unlink.to];

            links.delete(JSON.stringify(ends));
          }
        }
      }

      return {
        entities: [],
        links: [...links.values()]
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

  return {
    clientFor: (principal: Principal) => createRouterClient(router, { context: { principal } }),
  };
}

test("it serves an agent's asserted link through neighbourhood", async () => {
  const ctx = setupTest();

  const agent = ctx.clientFor({
    client: toTagged<ClientID>('client-atlas'),
    clientName: 'Atlas agent',
    grant: toTagged<GrantID>('grant-atlas'),
    scopes: ['read', 'write'],
  });

  const owner = ctx.clientFor({
    client: toTagged<ClientID>('client-ledger'),
    clientName: 'Ledger dashboard',
    grant: toTagged<GrantID>('grant-ledger'),
    scopes: ['read', 'write'],
  });

  await agent.assert_link({
    requestID: 'request-1',
    type: 'mentions',
    from: 'gmail:msg:17',
    to: { kind: 'entity', id: 'github:issue:412' },
    confidence: 0.8,
    evidence: 'the email quotes the issue title',
  });

  const result = await owner.neighbourhood({
    id: 'gmail:msg:17',
    depthLimit: 1,
    linkTypes: ['mentions'],
    includeHubs: false,
    minimumConfidence: 0.5,
  });

  expect(result).toStrictEqual({
    entities: [],
    links: [
      {
        type: 'mentions',
        from: toTagged<EntityID>('gmail:msg:17'),
        to: { kind: 'entity', id: toTagged<EntityID>('github:issue:412') },
        confidence: 0.8,
        direction: 'outgoing',
        depth: 1,
      },
    ],
  });
});

test("it drops an agent's asserted link from neighbourhood after a retraction", async () => {
  const ctx = setupTest();

  const agent = ctx.clientFor({
    client: toTagged<ClientID>('client-atlas'),
    clientName: 'Atlas agent',
    grant: toTagged<GrantID>('grant-atlas'),
    scopes: ['read', 'write'],
  });

  const owner = ctx.clientFor({
    client: toTagged<ClientID>('client-ledger'),
    clientName: 'Ledger dashboard',
    grant: toTagged<GrantID>('grant-ledger'),
    scopes: ['read', 'write'],
  });

  await agent.assert_link({
    requestID: 'request-1',
    type: 'mentions',
    from: 'gmail:msg:17',
    to: { kind: 'entity', id: 'github:issue:412' },
    confidence: 0.8,
    evidence: 'the email quotes the issue title',
  });

  await owner.retract_link({
    requestID: 'request-2',
    type: 'mentions',
    from: 'gmail:msg:17',
    to: { kind: 'entity', id: 'github:issue:412' },
    reason: 'the email quotes another issue',
  });

  const result = await owner.neighbourhood({
    id: 'gmail:msg:17',
    depthLimit: 1,
    linkTypes: ['mentions'],
    includeHubs: false,
    minimumConfidence: 0.5,
  });

  expect(result).toStrictEqual({ entities: [], links: [] });
});
