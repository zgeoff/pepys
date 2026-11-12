import { defineQuery } from '@pepys/kit';
import { z } from 'zod';
import { logbookVoyageConsumer } from './logbook-voyage-consumer.ts';

const voyageSchema = z.object({ id: z.string(), title: z.string(), logged_at: z.string() });

export const harbourVoyagesQuery = defineQuery({
  name: 'logbook_harbour_voyages',
  description: 'Returns the voyages logged in one harbour, oldest first.',
  input: z.object({ harbour: z.string().min(1) }),
  output: z.array(voyageSchema),
  reads: [logbookVoyageConsumer],
  handler: async (call) => {
    const rows = await call.db
      .selectFrom('logbook_voyage')
      .select(['id', 'title', 'logged_at'])
      .where('harbour', '=', call.input.harbour)
      .orderBy('logged_at')
      .orderBy('id')
      .execute();

    return rows;
  },
});
