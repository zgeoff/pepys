import { expect, onTestFinished, test } from 'bun:test';
import { checkDeployment } from '@pepys/kit';
import { createTestStore } from '@pepys/testing';
import invariant from 'tiny-invariant';
import { harbourPlugin, harbourSource } from '../../test-utils/harbour/harbour-plugin.ts';
import { buildQueryContext } from '../build-query-context.ts';
import { walkNeighbourhood } from './walk-neighbourhood.ts';

async function setupTest() {
  const store = await createTestStore({ plugins: [harbourPlugin] });

  onTestFinished(() => store[Symbol.asyncDispose]());

  const checked = checkDeployment({ name: 'harbour', plugins: [harbourPlugin] });

  invariant(checked.ok, 'the harbour deployment is valid');

  return { store, context: buildQueryContext(store.reader, checked.value) };
}

test('it walks one hop both ways and leaves the hub link types alone by default', async () => {
  const ctx = await setupTest();

  await ctx.store.apply(harbourSource, [
    {
      type: 'harbour.vessel.named',
      event: 'evt-1',
      entity: 'harbour:vessel:7',
      at: '2026-11-01T08:00:00.000Z',
      payload: { name: 'Tern' },
    },
    {
      type: 'harbour.voyage.departed',
      event: 'evt-2',
      entity: 'harbour:voyage:12',
      at: '2026-11-02T06:00:00.000Z',
      payload: { vessel: 'harbour:vessel:7', port: 'harbour:port:north', confidence: 0.9 },
    },
  ]);

  const walk = await walkNeighbourhood(ctx.context, {
    id: 'harbour:voyage:12',
    depthLimit: 1,
    entityLimit: 50,
    linkTypes: null,
    includeHubs: false,
    minimumConfidence: 0,
  });

  expect(walk).toStrictEqual({
    ok: true,
    value: {
      entities: [
        {
          id: 'harbour:voyage:12',
          kind: 'harbour:voyage',
          title: 'harbour:port:north',
          url: null,
          actor: 'harbour:vessel:7',
          updated_at: '2026-11-02T06:00:00.000Z',
          depth: 0,
        },
        {
          id: 'harbour:vessel:7',
          kind: 'harbour:vessel',
          title: 'Tern',
          url: null,
          actor: null,
          updated_at: '2026-11-01T08:00:00.000Z',
          depth: 1,
        },
      ],
      links: [
        {
          type: 'voyage_of',
          from: 'harbour:voyage:12',
          to: 'harbour:vessel:7',
          direction: 'outgoing',
          origin: 'harbour_voyage',
          confidence: 0.9,
          depth: 1,
        },
      ],
      unresolved: [],
      skippedConsumers: [],
      isTruncated: false,
    },
  });
});

test('it follows a hub link type when asked, and names each reached ID that no entity view holds', async () => {
  const ctx = await setupTest();

  await ctx.store.apply(harbourSource, [
    {
      type: 'harbour.voyage.departed',
      event: 'evt-1',
      entity: 'harbour:voyage:12',
      at: '2026-11-02T06:00:00.000Z',
      payload: { vessel: 'harbour:vessel:7', port: 'harbour:port:north', confidence: 1 },
    },
  ]);

  const walk = await walkNeighbourhood(ctx.context, {
    id: 'harbour:voyage:12',
    depthLimit: 1,
    entityLimit: 50,
    linkTypes: ['called_at'],
    includeHubs: true,
    minimumConfidence: 0,
  });

  expect(walk).toStrictEqual({
    ok: true,
    value: {
      entities: [expect.objectContaining({ id: 'harbour:voyage:12', depth: 0 })],
      links: [
        {
          type: 'called_at',
          from: 'harbour:voyage:12',
          to: 'harbour:port:north',
          direction: 'outgoing',
          origin: 'harbour_voyage',
          confidence: 1,
          depth: 1,
        },
      ],
      unresolved: ['harbour:port:north'],
      skippedConsumers: [],
      isTruncated: false,
    },
  });
});

test('it walks two hops and leaves out a link below the lowest confidence', async () => {
  const ctx = await setupTest();

  await ctx.store.apply(harbourSource, [
    {
      type: 'harbour.voyage.departed',
      event: 'evt-1',
      entity: 'harbour:voyage:12',
      at: '2026-11-02T06:00:00.000Z',
      payload: { vessel: 'harbour:vessel:7', port: 'harbour:port:north', confidence: 1 },
    },
    {
      type: 'harbour.voyage.departed',
      event: 'evt-2',
      entity: 'harbour:voyage:13',
      at: '2026-11-03T06:00:00.000Z',
      payload: { vessel: 'harbour:vessel:7', port: 'harbour:port:south', confidence: 0.8 },
    },
    {
      type: 'harbour.voyage.departed',
      event: 'evt-3',
      entity: 'harbour:voyage:14',
      at: '2026-11-04T06:00:00.000Z',
      payload: { vessel: 'harbour:vessel:7', port: 'harbour:port:south', confidence: 0.2 },
    },
  ]);

  const walk = await walkNeighbourhood(ctx.context, {
    id: 'harbour:voyage:12',
    depthLimit: 2,
    entityLimit: 50,
    linkTypes: null,
    includeHubs: false,
    minimumConfidence: 0.5,
  });

  expect(walk).toStrictEqual({
    ok: true,
    value: {
      entities: [
        expect.objectContaining({ id: 'harbour:voyage:12', depth: 0 }),
        expect.objectContaining({ id: 'harbour:voyage:13', depth: 2 }),
      ],
      links: [
        {
          type: 'voyage_of',
          from: 'harbour:voyage:12',
          to: 'harbour:vessel:7',
          direction: 'outgoing',
          origin: 'harbour_voyage',
          confidence: 1,
          depth: 1,
        },
        {
          type: 'voyage_of',
          from: 'harbour:voyage:13',
          to: 'harbour:vessel:7',
          direction: 'incoming',
          origin: 'harbour_voyage',
          confidence: 0.8,
          depth: 2,
        },
      ],
      unresolved: ['harbour:vessel:7'],
      skippedConsumers: [],
      isTruncated: false,
    },
  });
});

test('it names each consumer with no current version as skipped', async () => {
  const ctx = await setupTest();

  await ctx.store.apply(harbourSource, [
    {
      type: 'harbour.vessel.named',
      event: 'evt-1',
      entity: 'harbour:vessel:7',
      at: '2026-11-01T08:00:00.000Z',
      payload: { name: 'Tern' },
    },
  ]);

  ctx.store.reader.markDown('harbour_voyage');

  const walk = await walkNeighbourhood(ctx.context, {
    id: 'harbour:vessel:7',
    depthLimit: 1,
    entityLimit: 50,
    linkTypes: null,
    includeHubs: false,
    minimumConfidence: 0,
  });

  expect(walk).toStrictEqual({
    ok: true,
    value: {
      entities: [expect.objectContaining({ id: 'harbour:vessel:7', depth: 0 })],
      links: [],
      unresolved: [],
      skippedConsumers: ['harbour_voyage'],
      isTruncated: false,
    },
  });
});

test.each([
  ['NOT_FOUND', 'a start of a kind no plug-in brings', 'ledger:account:reef', null],
  ['BAD_REQUEST', 'a start that is no entity ID', 'vessel-7', null],
  ['BAD_REQUEST', 'an unknown link type', 'harbour:vessel:7', ['towed_by']],
])('it answers %s for %s', async (code, _case, id, linkTypes) => {
  const ctx = await setupTest();

  const walk = await walkNeighbourhood(ctx.context, {
    id,
    depthLimit: 1,
    entityLimit: 50,
    linkTypes,
    includeHubs: false,
    minimumConfidence: 0,
  });

  expect(walk).toMatchObject({ ok: false, failure: { code } });
});
