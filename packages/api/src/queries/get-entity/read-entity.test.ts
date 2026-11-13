import { expect, onTestFinished, test } from 'bun:test';
import { checkDeployment } from '@pepys/kit';
import type { EntityID } from '@pepys/kit';
import { createTestStore } from '@pepys/testing';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { harbourPlugin, harbourSource } from '../../test-utils/harbour/harbour-plugin.ts';
import { buildQueryContext } from '../build-query-context.ts';
import { readEntity } from './read-entity.ts';

async function setupTest() {
  const store = await createTestStore({ plugins: [harbourPlugin] });

  onTestFinished(() => store[Symbol.asyncDispose]());

  const checked = checkDeployment({ name: 'harbour', plugins: [harbourPlugin] });

  invariant(checked.ok, 'the harbour deployment is valid');

  return { store, context: buildQueryContext(store.reader, checked.value) };
}

test('it returns the summary, the owning consumer and table, and the full row of an entity', async () => {
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

  const read = await readEntity(ctx.context, 'harbour:voyage:12');

  expect(read).toStrictEqual({
    ok: true,
    value: {
      entity: {
        id: toTagged<EntityID>('harbour:voyage:12'),
        kind: 'harbour:voyage',
        title: 'harbour:port:north',
        url: null,
        actor: toTagged<EntityID>('harbour:vessel:7'),
        updated_at: '2026-11-02T06:00:00.000Z',
      },
      consumer: 'harbour_voyage',
      table: 'harbour_voyage',
      row: {
        id: 'harbour:voyage:12',
        vessel_id: 'harbour:vessel:7',
        port_id: 'harbour:port:north',
        is_hailed: true,
        departed_at: '2026-11-02T06:00:00.000Z',
      },
    },
  });
});

test.each([
  ['an ID of a kind no entity view holds', 'harbour:port:north'],
  ['an ID of a kind no plug-in brings', 'ledger:account:reef'],
  ['an ID no row holds', 'harbour:vessel:404'],
  ['an alias no row holds', 'vessel-7'],
])('it answers NOT_FOUND for %s', async (_case, id) => {
  const ctx = await setupTest();
  const read = await readEntity(ctx.context, id);

  expect(read).toStrictEqual({
    ok: false,
    failure: { code: 'NOT_FOUND', message: `no entity ${id}` },
  });
});

test.each([['tern'], ['Tern'], [' TERN '], ['tern/']])(
  'it returns the entity that the alias %p names',
  async (alias) => {
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

    const read = await readEntity(ctx.context, alias);

    expect(read).toStrictEqual({
      ok: true,
      value: {
        entity: {
          id: toTagged<EntityID>('harbour:vessel:7'),
          kind: 'harbour:vessel',
          title: 'Tern',
          url: null,
          actor: null,
          updated_at: '2026-11-01T08:00:00.000Z',
        },
        consumer: 'harbour_vessel',
        table: 'harbour_vessel',
        row: { id: 'harbour:vessel:7', name: 'Tern', updated_at: '2026-11-01T08:00:00.000Z' },
      },
    });
  },
);

test('it answers SERVICE_UNAVAILABLE for an alias it cannot find while the alias consumer has no current version', async () => {
  const ctx = await setupTest();

  ctx.store.reader.markDown('harbour_vessel');

  const read = await readEntity(ctx.context, 'tern');

  expect(read).toStrictEqual({
    ok: false,
    failure: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'the consumer harbour_vessel has no current version',
    },
  });
});

test('it answers SERVICE_UNAVAILABLE when the owning consumer has no current version', async () => {
  const ctx = await setupTest();

  ctx.store.reader.markDown('harbour_vessel');

  const read = await readEntity(ctx.context, 'harbour:vessel:7');

  expect(read).toStrictEqual({
    ok: false,
    failure: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'the consumer harbour_vessel has no current version',
    },
  });
});
