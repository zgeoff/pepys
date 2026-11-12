import { defineSource, receiveFactBatch } from '@pepys/kit';
import { voyageFamily } from './voyage-family.ts';

export const logbookSource = defineSource({
  name: 'logbook',
  families: [voyageFamily],
  live: receiveFactBatch({
    route: '/logbook/facts',
    check: { kind: 'hmac-sha256', header: 'x-logbook-signature', secretEnv: 'LOGBOOK_SECRET' },
  }),
});
