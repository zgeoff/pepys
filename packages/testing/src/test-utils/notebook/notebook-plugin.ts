import {
  defineConsumer,
  defineFactFamily,
  definePlugin,
  defineQuery,
  defineSource,
  defineTable,
  receiveFactBatch,
} from '@pepys/kit';
import type { EntityID } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { z } from 'zod';

const originSchema = z.object({ issuer: z.string(), subject: z.string() });

const noteFamily = defineFactFamily({
  stream: 'facts.notebook.note',
  api: 'notebook/1',
  entityKind: 'notebook:note',
  types: {
    'notebook.note.written': z.object({ text: z.string(), origin: originSchema }),
  },
});

export const notebookSource = defineSource({
  name: 'notebook',
  families: [noteFamily],
  live: receiveFactBatch({
    route: '/notebook/facts',
    check: { kind: 'token', header: 'authorization', secretEnv: 'NOTEBOOK_TOKEN' },
  }),
});

// A stub fact-mode consumer, whose entry reads its own row back.
export const notebookNoteConsumer = defineConsumer({
  name: 'notebook_note',
  entry: new URL('consumers/notebook-note.ts', import.meta.url),
  input: { mode: 'fact', streams: [noteFamily.stream] },
  tables: {
    notebook_note: defineTable({
      columns: {
        id: { kind: 'entityID' },
        text: { kind: 'text' },
        count: { kind: 'integer' },
        issuer: { kind: 'text' },
      },
      primaryKey: ['id'],
      indexes: [],
    }),
  },
  entityViews: [
    {
      table: 'notebook_note',
      kind: 'notebook:note',
      id: 'id',
      title: 'text',
      url: null,
      actor: null,
      updatedAt: 'text',
    },
  ],
  reads: ['notebook_note'],
  links: [],
});

export const notebookCountQuery = defineQuery({
  name: 'notebook_count',
  description: 'The count of one note.',
  input: z.object({ id: z.string() }),
  output: z.object({ count: z.number() }),
  reads: [notebookNoteConsumer],
  handler: async (call) => {
    const row = await call.db
      .selectFrom('notebook_note')
      .select('count')
      .where('id', '=', toTagged<EntityID>(call.input.id))
      .executeTakeFirstOrThrow();

    return { count: row.count };
  },
});

// A query that breaks the read-only rule: its handler deletes every note.
export const notebookPurgeQuery = defineQuery({
  name: 'notebook_purge',
  description: 'Deletes every note.',
  input: z.object({}),
  output: z.object({}),
  reads: [notebookNoteConsumer],
  handler: async (call) => {
    // oxlint-disable-next-line zgeoff/seed-only -- the write a query handler must not keep
    await call.db.deleteFrom('notebook_note').execute();

    return {};
  },
});

export const notebookPlugin = definePlugin({
  name: 'notebook',
  sources: [notebookSource],
  consumers: [notebookNoteConsumer],
  queries: [notebookCountQuery, notebookPurgeQuery],
});
