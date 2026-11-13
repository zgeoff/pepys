import { expect, test } from 'bun:test';
import { defineConsumer, definePlugin, defineTable } from '@pepys/kit';
import type { VersionHash } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { buildConsumerBuildManifest } from './build-consumer-build-manifest.ts';
import { buildConsumerManifest } from './build-consumer-manifest.ts';
import { checkBuildTarget } from './check-build-target.ts';

function setupTest() {
  const consumer = defineConsumer({
    name: 'tide_log',
    entry: new URL('file:///stub/src/consumers/tide-log.ts'),
    input: { mode: 'fact', streams: ['facts.harbour.tide'] },
    tables: {
      tide_reading: defineTable({
        columns: { id: { kind: 'entityID' } },
        primaryKey: ['id'],
        indexes: [],
      }),
    },
    entityViews: [],
    reads: [],
    links: [],
  });

  const plugin = definePlugin({ name: 'harbour', consumers: [consumer] });

  return {
    consumer,
    buildForPlugin: (module: VersionHash) => {
      const target = checkBuildTarget({ kind: 'plugin', plugin });

      invariant(target.ok);

      return buildConsumerBuildManifest({
        target: target.value,
        modules: [{ name: 'tide_log', module, path: `tide_log/${module}.wasm` }],
      });
    },
  };
}

test('it lists each consumer whole, with its module and its version', () => {
  const ctx = setupTest();
  const module = toTagged<VersionHash>('a'.repeat(64));

  expect(ctx.buildForPlugin(module)).toStrictEqual({
    kit: 1,
    deployment: null,
    consumers: [
      {
        name: 'tide_log',
        module,
        path: `tide_log/${module}.wasm`,
        pins: {},
        version: expect.stringMatching(/^[0-9a-f]{64}$/u),
        manifest: buildConsumerManifest(ctx.consumer),
      },
    ],
  });
});

test('it gives a new version for a new module of the same consumer', () => {
  const ctx = setupTest();
  const first = ctx.buildForPlugin(toTagged<VersionHash>('a'.repeat(64)));
  const second = ctx.buildForPlugin(toTagged<VersionHash>('b'.repeat(64)));
  const [firstConsumer] = first.consumers;
  const [secondConsumer] = second.consumers;

  invariant(firstConsumer);
  invariant(secondConsumer);

  expect(secondConsumer.version).not.toBe(firstConsumer.version);
});
