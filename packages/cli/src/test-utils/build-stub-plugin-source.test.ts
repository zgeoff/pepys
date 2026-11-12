import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { buildStubPluginSource } from './build-stub-plugin-source.ts';

async function setupTest() {
  const root = await mkdtemp(join(tmpdir(), 'pepys-stub-plugin-source-'));

  onTestFinished(() => rm(root, { recursive: true, force: true }));

  return {
    root,
    readPlugin: async (source: string) => {
      const path = join(root, 'plugin.ts');

      await Bun.write(path, source);

      const loaded: unknown = await import(path);

      return z.object({ plugin: z.unknown() }).parse(loaded).plugin;
    },
  };
}

test('it declares the tickets plug-in, with a text column for each extra column beside the entity ID', async () => {
  const ctx = await setupTest();
  const plugin = await ctx.readPlugin(buildStubPluginSource(['title', 'status']));

  expect(plugin).toStrictEqual({
    kit: 1,
    name: 'tickets',
    sources: [
      {
        name: 'tickets',
        families: [
          {
            stream: 'facts.tickets.ticket',
            api: 'tickets/1',
            entityKind: 'tickets:ticket',
            types: { 'tickets.ticket.opened': expect.objectContaining({ type: 'object' }) },
          },
        ],
      },
    ],
    consumers: [
      {
        name: 'stub_tickets',
        entry: Bun.pathToFileURL(join(ctx.root, 'consumers/stub-tickets.ts')),
        input: { mode: 'fact', streams: ['facts.tickets.ticket'] },
        tables: {
          ticket: {
            columns: {
              id: { kind: 'entityID' },
              title: { kind: 'text' },
              status: { kind: 'text' },
            },
            primaryKey: ['id'],
            indexes: [],
          },
        },
        entityViews: [],
        reads: [],
        links: [],
      },
    ],
    queries: [],
    settings: undefined,
    linkTypes: [],
    entityKinds: ['tickets:ticket'],
  });
});

test('it declares the entity ID alone when no extra column is given', async () => {
  const ctx = await setupTest();
  const plugin = await ctx.readPlugin(buildStubPluginSource([]));

  expect(plugin).toStrictEqual({
    kit: 1,
    name: 'tickets',
    sources: [
      {
        name: 'tickets',
        families: [
          {
            stream: 'facts.tickets.ticket',
            api: 'tickets/1',
            entityKind: 'tickets:ticket',
            types: { 'tickets.ticket.opened': expect.objectContaining({ type: 'object' }) },
          },
        ],
      },
    ],
    consumers: [
      {
        name: 'stub_tickets',
        entry: Bun.pathToFileURL(join(ctx.root, 'consumers/stub-tickets.ts')),
        input: { mode: 'fact', streams: ['facts.tickets.ticket'] },
        tables: {
          ticket: { columns: { id: { kind: 'entityID' } }, primaryKey: ['id'], indexes: [] },
        },
        entityViews: [],
        reads: [],
        links: [],
      },
    ],
    queries: [],
    settings: undefined,
    linkTypes: [],
    entityKinds: ['tickets:ticket'],
  });
});
