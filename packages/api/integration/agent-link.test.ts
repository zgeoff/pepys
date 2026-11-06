import { expect, test } from 'bun:test';
import { createRouterClient } from '@orpc/server';
import { createMemoryFactLog } from '@pepys/ingest';
import type { ClientID, EntityID, GrantID, StreamName } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import type { Principal } from '../src/principal/principal.ts';
import { createStubLinkCatalog } from '../src/test-utils/create-stub-link-catalog.ts';

function setupTest() {
  const log = createMemoryFactLog([toTagged<StreamName>('facts.manual.link')]);
  const catalog = createStubLinkCatalog(log, toTagged<StreamName>('facts.manual.link'));

  return {
    clientFor: (principal: Principal) => createRouterClient(catalog, { context: { principal } }),
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
