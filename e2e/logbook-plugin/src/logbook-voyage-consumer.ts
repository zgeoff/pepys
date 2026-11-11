import { defineConsumer, defineLinkType, defineTable } from '@pepys/kit';
import { voyageFamily } from './voyage-family.ts';

const voyageCitesLinkType = defineLinkType({
  name: 'logbook_voyage_cites',
  from: ['logbook:voyage'],
  to: ['github:pull_request'],
  hub: false,
});

export const logbookVoyageConsumer = defineConsumer({
  name: 'logbook_voyage',
  entry: new URL('consumers/logbook-voyage.ts', import.meta.url),
  input: { mode: 'fact', streams: [voyageFamily.stream] },
  tables: {
    logbook_voyage: defineTable({
      columns: {
        id: { kind: 'entityID' },
        title: { kind: 'text' },
        harbour: { kind: 'text' },
        logged_at: { kind: 'timestamp' },
      },
      primaryKey: ['id'],
      indexes: [{ columns: ['harbour'] }],
    }),
  },
  entityViews: [
    {
      table: 'logbook_voyage',
      kind: voyageFamily.entityKind,
      id: 'id',
      title: 'title',
      url: null,
      actor: null,
      updatedAt: 'logged_at',
    },
  ],
  reads: [],
  links: [voyageCitesLinkType],
});
