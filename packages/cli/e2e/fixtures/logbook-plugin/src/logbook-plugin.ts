import { definePlugin } from '@pepys/kit';
import { harbourVoyagesQuery } from './harbour-voyages-query.ts';
import { logbookSource } from './logbook-source.ts';
import { logbookVoyageConsumer } from './logbook-voyage-consumer.ts';

// Its link ends at `github:pull_request`, so a deployment of it needs the GitHub plug-in too.
export const logbookPlugin = definePlugin({
  name: 'logbook',
  sources: [logbookSource],
  consumers: [logbookVoyageConsumer],
  queries: [harbourVoyagesQuery],
});
