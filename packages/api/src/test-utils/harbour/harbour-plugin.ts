import {
  defineConsumer,
  defineFactFamily,
  defineLinkType,
  definePlugin,
  defineQuery,
  defineSource,
  defineTable,
  receiveFactBatch,
} from '@pepys/kit';
import type { EntityID } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { z } from 'zod';

// A stub plug-in of two fact-mode consumers in two files: vessels, and voyages that link to a
// vessel and, through a hub link type, to a port that no consumer holds.

const vesselFamily = defineFactFamily({
  stream: 'facts.harbour.vessel',
  api: 'harbour/1',
  entityKind: 'harbour:vessel',
  types: { 'harbour.vessel.named': z.object({ name: z.string() }) },
});

const voyageFamily = defineFactFamily({
  stream: 'facts.harbour.voyage',
  api: 'harbour/1',
  entityKind: 'harbour:voyage',
  types: {
    'harbour.voyage.departed': z.object({
      vessel: z.string(),
      port: z.string(),
      confidence: z.number(),
    }),
  },
});

const portFamily = defineFactFamily({
  stream: 'facts.harbour.port',
  api: 'harbour/1',
  entityKind: 'harbour:port',
  types: { 'harbour.port.opened': z.object({}) },
});

export const harbourSource = defineSource({
  name: 'harbour',
  families: [vesselFamily, voyageFamily, portFamily],
  live: receiveFactBatch({
    route: '/harbour/facts',
    check: { kind: 'hmac-sha256', header: 'x-harbour-signature-256', secretEnv: 'HARBOUR_SECRET' },
  }),
});

const voyageOf = defineLinkType({
  name: 'voyage_of',
  from: ['harbour:voyage'],
  to: ['harbour:vessel'],
  hub: false,
});

const calledAt = defineLinkType({
  name: 'called_at',
  from: ['harbour:voyage'],
  to: ['harbour:port'],
  hub: true,
});

export const harbourVesselConsumer = defineConsumer({
  name: 'harbour_vessel',
  entry: new URL('consumers/harbour-vessel.ts', import.meta.url),
  input: { mode: 'fact', streams: [vesselFamily.stream] },
  tables: {
    harbour_vessel: defineTable({
      columns: {
        id: { kind: 'entityID' },
        name: { kind: 'text' },
        updated_at: { kind: 'timestamp' },
      },
      primaryKey: ['id'],
      indexes: [],
    }),
  },
  entityViews: [
    {
      table: 'harbour_vessel',
      kind: 'harbour:vessel',
      id: 'id',
      title: 'name',
      url: null,
      actor: null,
      updatedAt: 'updated_at',
    },
  ],
  reads: [],
  links: [],
});

export const harbourVoyageConsumer = defineConsumer({
  name: 'harbour_voyage',
  entry: new URL('consumers/harbour-voyage.ts', import.meta.url),
  input: { mode: 'fact', streams: [voyageFamily.stream] },
  tables: {
    harbour_voyage: defineTable({
      columns: {
        id: { kind: 'entityID' },
        vessel_id: { kind: 'entityID' },
        port_id: { kind: 'entityID' },
        is_hailed: { kind: 'boolean' },
        departed_at: { kind: 'timestamp' },
      },
      primaryKey: ['id'],
      indexes: [],
    }),
  },
  entityViews: [
    {
      table: 'harbour_voyage',
      kind: 'harbour:voyage',
      id: 'id',
      title: 'port_id',
      url: null,
      actor: 'vessel_id',
      updatedAt: 'departed_at',
    },
  ],
  reads: [],
  links: [voyageOf, calledAt],
});

export const harbourVoyageCountQuery = defineQuery({
  name: 'harbour_voyage_count',
  description: 'Counts the voyages of one vessel.',
  input: z.object({ vessel: z.string().describe('The entity ID of the vessel.') }),
  output: z.object({ count: z.number() }),
  reads: [harbourVoyageConsumer],
  handler: async (call) => {
    const row = await call.db
      .selectFrom('harbour_voyage')
      .select((builder) => builder.fn.countAll<number>().as('count'))
      .where('vessel_id', '=', toTagged<EntityID>(call.input.vessel))
      .executeTakeFirstOrThrow();

    return { count: row.count };
  },
});

const vesselPortSchema = z.object({ name: z.string(), port: z.string(), title: z.string() });

// Joins the tables of two consumers, and reads the shared entity view.
export const harbourVesselPortsQuery = defineQuery({
  name: 'harbour_vessel_ports',
  description: 'Lists the ports each named vessel left from, with the title of each voyage.',
  input: z.object({}),
  output: z.object({ ports: z.array(vesselPortSchema) }),
  reads: [harbourVesselConsumer, harbourVoyageConsumer],
  handler: async (call) => {
    const rows = await call.db
      .selectFrom('harbour_voyage')
      .innerJoin('harbour_vessel', 'harbour_vessel.id', 'harbour_voyage.vessel_id')
      .innerJoin('entity', 'entity.id', 'harbour_voyage.id')
      .select([
        'harbour_vessel.name as name',
        'harbour_voyage.port_id as port',
        'entity.title as title',
      ])
      .orderBy('harbour_voyage.id')
      .execute();

    return { ports: rows };
  },
});

export const harbourPlugin = definePlugin({
  name: 'harbour',
  sources: [harbourSource],
  consumers: [harbourVesselConsumer, harbourVoyageConsumer],
  queries: [harbourVoyageCountQuery, harbourVesselPortsQuery],
});
