import { expect, test } from 'bun:test';
import { createRouterClient } from '@orpc/server';
import { createMemoryFactLog } from '@pepys/ingest';
import type { FactLog } from '@pepys/ingest';
import type { ClientID, EntityID, GrantID, StreamName, StreamOffset } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import { createStubLinkCatalog } from './create-stub-link-catalog.ts';

function setupTest() {
  const log = createMemoryFactLog([toTagged<StreamName>('facts.manual.link')]);

  const context = {
    principal: {
      client: toTagged<ClientID>('client-atlas'),
      clientName: 'Atlas agent',
      grant: toTagged<GrantID>('grant-atlas'),
      scopes: ['read', 'write'] as const,
    },
  };

  const unknownLog: FactLog = {
    append: () => Promise.resolve({ kind: 'unknown' }),
    read: () => Promise.resolve({ ok: true, value: [] }),
    readTail: () => Promise.resolve({ ok: true, value: toTagged<StreamOffset>(0) }),
  };

  const client = createRouterClient(
    createStubLinkCatalog(log, toTagged<StreamName>('facts.manual.link')),
    { context },
  );

  const rejectingClient = createRouterClient(
    createStubLinkCatalog(log, toTagged<StreamName>('facts.manual.other')),
    { context },
  );

  const unknownClient = createRouterClient(
    createStubLinkCatalog(unknownLog, toTagged<StreamName>('facts.manual.link')),
    { context },
  );

  return {
    client,
    rejectingClient,
    unknownClient,
    readFacts: () =>
      log.read(toTagged<StreamName>('facts.manual.link'), toTagged<StreamOffset>(0), 10),
  };
}

test('it refuses an assert link that the log rejects', () => {
  const ctx = setupTest();

  expect(
    ctx.rejectingClient.assert_link({
      requestID: 'request-1',
      type: 'mentions',
      from: 'gmail:msg:17',
      to: { kind: 'entity', id: 'github:issue:412' },
      confidence: 0.8,
      evidence: 'the email quotes the issue title',
    }),
  ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
});

test('it refuses an assert link whose append outcome is unknown', () => {
  const ctx = setupTest();

  expect(
    ctx.unknownClient.assert_link({
      requestID: 'request-1',
      type: 'mentions',
      from: 'gmail:msg:17',
      to: { kind: 'entity', id: 'github:issue:412' },
      confidence: 0.8,
      evidence: 'the email quotes the issue title',
    }),
  ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
});

test('it refuses a retract link that the log rejects', () => {
  const ctx = setupTest();

  expect(
    ctx.rejectingClient.retract_link({
      requestID: 'request-2',
      type: 'mentions',
      from: 'gmail:msg:17',
      to: { kind: 'entity', id: 'github:issue:412' },
      reason: 'the email quotes another issue',
    }),
  ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
});

test('it refuses a retract link whose append outcome is unknown', () => {
  const ctx = setupTest();

  expect(
    ctx.unknownClient.retract_link({
      requestID: 'request-2',
      type: 'mentions',
      from: 'gmail:msg:17',
      to: { kind: 'entity', id: 'github:issue:412' },
      reason: 'the email quotes another issue',
    }),
  ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
});

test('it appends an asserted link as one manual fact under the fact ID it returns', async () => {
  const ctx = setupTest();

  const asserted = await ctx.client.assert_link({
    requestID: 'request-1',
    type: 'mentions',
    from: 'gmail:msg:17',
    to: { kind: 'entity', id: 'github:issue:412' },
    confidence: 0.8,
    evidence: 'the email quotes the issue title',
  });

  const facts = await ctx.readFacts();

  expect(facts).toStrictEqual({
    ok: true,
    value: [
      {
        offset: toTagged<StreamOffset>(0),
        fact: {
          id: asserted.fact,
          type: 'link.asserted',
          v: 1,
          api: 'pepys/1',
          entity: toTagged<EntityID>('gmail:msg:17'),
          at: '2026-10-01T08:00:00Z',
          payload: {
            action: 'assert',
            type: 'mentions',
            from: 'gmail:msg:17',
            to: 'github:issue:412',
            confidence: 0.8,
            evidence: 'the email quotes the issue title',
          },
        },
      },
    ],
  });
});

test('it gives a manual fact ID to an asserted link', async () => {
  const ctx = setupTest();

  const asserted = await ctx.client.assert_link({
    requestID: 'request-1',
    type: 'mentions',
    from: 'gmail:msg:17',
    to: { kind: 'entity', id: 'github:issue:412' },
    confidence: 0.8,
    evidence: 'the email quotes the issue title',
  });

  expect(asserted.fact).toMatch(/^manual:[0-9a-f]{64}$/u);
});

test('it leaves a link below the minimum confidence out of neighbourhood', async () => {
  const ctx = setupTest();

  await ctx.client.assert_link({
    requestID: 'request-1',
    type: 'mentions',
    from: 'gmail:msg:17',
    to: { kind: 'entity', id: 'github:issue:412' },
    confidence: 0.3,
    evidence: 'the email names the issue number',
  });

  const result = await ctx.client.neighbourhood({
    id: 'gmail:msg:17',
    depthLimit: 1,
    linkTypes: ['mentions'],
    includeHubs: false,
    minimumConfidence: 0.5,
  });

  expect(result).toStrictEqual({ entities: [], links: [] });
});

test('it serves a link again when it is asserted after a retraction', async () => {
  const ctx = setupTest();

  await ctx.client.assert_link({
    requestID: 'request-1',
    type: 'mentions',
    from: 'gmail:msg:17',
    to: { kind: 'entity', id: 'github:issue:412' },
    confidence: 0.8,
    evidence: 'the email quotes the issue title',
  });

  await ctx.client.retract_link({
    requestID: 'request-2',
    type: 'mentions',
    from: 'gmail:msg:17',
    to: { kind: 'entity', id: 'github:issue:412' },
    reason: 'the email quotes another issue',
  });

  await ctx.client.assert_link({
    requestID: 'request-3',
    type: 'mentions',
    from: 'gmail:msg:17',
    to: { kind: 'entity', id: 'github:issue:412' },
    confidence: 0.6,
    evidence: 'the reply names the issue',
  });

  const result = await ctx.client.neighbourhood({
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
        confidence: 0.6,
        direction: 'outgoing',
        depth: 1,
      },
    ],
  });
});
