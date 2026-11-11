import { expect, test } from 'bun:test';
import { defineConsumer, defineDeployment, definePlugin, defineQuery } from '@pepys/kit';
import { z } from 'zod';
import { checkBuildTarget } from './check-build-target.ts';

function setupTest() {
  return {
    settingsPlugin: definePlugin({
      name: 'tickets',
      settings: {
        schema: z.object({ project: z.string().min(3) }),
        defaults: { project: 'main' },
      },
    }),
    buildConsumer: (name: string) =>
      defineConsumer({
        name,
        entry: new URL('file:///stub/consumers/stub.ts'),
        input: { mode: 'fact', streams: [] },
        tables: {},
        entityViews: [],
        reads: [],
        links: [],
      }),
  };
}

test('it gives a plug-in built alone its default settings', () => {
  const ctx = setupTest();
  const checked = checkBuildTarget({ kind: 'plugin', plugin: ctx.settingsPlugin });

  expect(checked).toMatchObject({
    ok: true,
    value: {
      checked: { settings: { tickets: { project: 'main' } } },
      plugins: [ctx.settingsPlugin],
    },
  });
});

test('it passes a plug-in whose query reads a consumer of another plug-in', () => {
  const ctx = setupTest();

  const query = defineQuery({
    name: 'list_notes',
    description: 'Lists notes.',
    input: z.object({}),
    output: z.object({}),
    reads: [ctx.buildConsumer('notes_table')],
    handler: () => Promise.resolve({}),
  });

  const plugin = definePlugin({ name: 'tickets', queries: [query] });

  expect(checkBuildTarget({ kind: 'plugin', plugin })).toMatchObject({ ok: true });
});

test('it fails a plug-in with two consumers of one name', () => {
  const ctx = setupTest();
  const consumer = ctx.buildConsumer('tickets_table');
  const plugin = definePlugin({ name: 'tickets', consumers: [consumer, consumer] });

  expect(checkBuildTarget({ kind: 'plugin', plugin })).toStrictEqual({
    ok: false,
    failure: [
      { kind: 'duplicate', of: 'consumer', name: 'tickets_table', plugins: ['tickets', 'tickets'] },
    ],
  });
});

test('it fails a deployment whose settings fail the schema', () => {
  const ctx = setupTest();

  const deployment = defineDeployment({
    name: 'home',
    plugins: [ctx.settingsPlugin],
    settings: { tickets: { project: 'ab' } },
  });

  expect(checkBuildTarget({ kind: 'deployment', deployment })).toMatchObject({
    ok: false,
    failure: [{ kind: 'invalid-settings', plugin: 'tickets' }],
  });
});
