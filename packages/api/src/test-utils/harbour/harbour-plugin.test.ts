import { expect, onTestFinished, test } from 'bun:test';
import { createTestStore } from '@pepys/testing';
import {
  harbourPlugin,
  harbourSource,
  harbourVesselPortsQuery,
  harbourVoyageCountQuery,
} from './harbour-plugin.ts';

async function setupTest() {
  const store = await createTestStore({ plugins: [harbourPlugin] });

  onTestFinished(() => store[Symbol.asyncDispose]());

  return { store };
}

test('it writes a vessel row, a voyage row, and the two links of the voyage', async () => {
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

  expect({
    vessels: await ctx.store.readRows('harbour_vessel'),
    voyages: await ctx.store.readRows('harbour_voyage'),
    links: await ctx.store.readLinks(),
  }).toStrictEqual({
    vessels: [{ id: 'harbour:vessel:7', name: 'Tern', updated_at: '2026-11-01T08:00:00.000Z' }],
    voyages: [
      {
        id: 'harbour:voyage:12',
        vessel_id: 'harbour:vessel:7',
        port_id: 'harbour:port:north',
        is_hailed: true,
        departed_at: '2026-11-02T06:00:00.000Z',
      },
    ],
    links: [
      expect.objectContaining({
        type: 'called_at',
        from_id: 'harbour:voyage:12',
        to_id: 'harbour:port:north',
        confidence: 1,
      }),
      expect.objectContaining({
        type: 'voyage_of',
        from_id: 'harbour:voyage:12',
        to_id: 'harbour:vessel:7',
        confidence: 0.9,
      }),
    ],
  });
});

test('it counts the voyages of a vessel and lists its ports through the plug-in queries', async () => {
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
      payload: { vessel: 'harbour:vessel:7', port: 'harbour:port:north', confidence: 1 },
    },
  ]);

  expect({
    count: await ctx.store.query(harbourVoyageCountQuery, { vessel: 'harbour:vessel:7' }),
    ports: await ctx.store.query(harbourVesselPortsQuery, {}),
  }).toStrictEqual({
    count: { count: 1 },
    ports: { ports: [{ name: 'Tern', port: 'harbour:port:north', title: 'harbour:port:north' }] },
  });
});
