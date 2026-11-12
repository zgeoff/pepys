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

      const consumerSchema = z.object({
        name: z.string(),
        entry: z.instanceof(URL),
        tables: z.unknown(),
      });

      const pluginSchema = z.object({ name: z.string(), consumers: z.array(consumerSchema) });

      return z.object({ plugin: pluginSchema }).parse(loaded).plugin;
    },
  };
}

test('it declares a text column for each extra column beside the entity ID', async () => {
  const ctx = await setupTest();
  const plugin = await ctx.readPlugin(buildStubPluginSource(['title', 'status']));

  expect(plugin.consumers.map((consumer) => consumer.tables)).toStrictEqual([
    {
      ticket: {
        columns: { id: { kind: 'entityID' }, title: { kind: 'text' }, status: { kind: 'text' } },
        primaryKey: ['id'],
        indexes: [],
      },
    },
  ]);
});

test('it declares the entity ID alone when no extra column is given', async () => {
  const ctx = await setupTest();
  const plugin = await ctx.readPlugin(buildStubPluginSource([]));

  expect(plugin.consumers.map((consumer) => consumer.tables)).toStrictEqual([
    { ticket: { columns: { id: { kind: 'entityID' } }, primaryKey: ['id'], indexes: [] } },
  ]);
});

test('it puts the consumer entry beside the plug-in file, outside the repo', async () => {
  const ctx = await setupTest();
  const plugin = await ctx.readPlugin(buildStubPluginSource(['title']));

  expect({
    name: plugin.name,
    consumers: plugin.consumers.map((consumer) => ({
      name: consumer.name,
      entry: consumer.entry.href,
    })),
  }).toStrictEqual({
    name: 'tickets',
    consumers: [
      {
        name: 'stub_tickets',
        entry: Bun.pathToFileURL(join(ctx.root, 'consumers/stub-tickets.ts')).href,
      },
    ],
  });
});
