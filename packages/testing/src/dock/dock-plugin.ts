import {
  defineConsumer,
  defineFactFamily,
  definePlugin,
  defineSource,
  defineTable,
  receiveFactBatch,
} from '@pepys/kit';
import { z } from 'zod';

const arrivalFamily = defineFactFamily({
  stream: 'facts.dock.arrival',
  api: 'dock/1',
  entityKind: 'dock:berth',
  types: {
    'dock.arrival.logged': z.object({ vessel: z.string() }),
  },
});

const loadFamily = defineFactFamily({
  stream: 'facts.dock.load',
  api: 'dock/1',
  entityKind: 'dock:berth',
  types: {
    'dock.load.weighed': z.object({ tonnes: z.number().int() }),
  },
});

export const dockSource = defineSource({
  name: 'dock',
  families: [arrivalFamily, loadFamily],
  live: receiveFactBatch({
    route: '/dock/facts',
    check: { kind: 'hmac-sha256', header: 'x-dock-signature-256', secretEnv: 'DOCK_SECRET' },
  }),
});

// A stub scope consumer whose scope spans two streams: one berth is one scope, and its row shows
// what the consumer read from the arrival stream and the load stream together.
export const dockBerthConsumer = defineConsumer({
  name: 'dock_berth',
  entry: new URL('consumers/dock-berth.ts', import.meta.url),
  input: {
    mode: 'scope',
    scopeKind: 'dock:berth',
    streams: [arrivalFamily.stream, loadFamily.stream],
  },
  tables: {
    dock_berth: defineTable({
      columns: {
        id: { kind: 'entityID' },
        arrivals: { kind: 'integer' },
        tonnes: { kind: 'integer' },
        read_order: { kind: 'text' },
        updated_at: { kind: 'timestamp' },
      },
      primaryKey: ['id'],
      indexes: [],
    }),
  },
  entityViews: [
    {
      table: 'dock_berth',
      kind: 'dock:berth',
      id: 'id',
      title: 'read_order',
      url: null,
      actor: null,
      updatedAt: 'updated_at',
    },
  ],
  reads: [],
  links: [],
});

export const dockPlugin = definePlugin({
  name: 'dock',
  sources: [dockSource],
  consumers: [dockBerthConsumer],
});
