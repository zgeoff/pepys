import { expect, test } from 'bun:test';
import { defineConsumer, definePlugin } from '@pepys/kit';
import invariant from 'tiny-invariant';
import { checkBuildTarget } from './check-build-target.ts';
import { collectGlueFiles } from './collect-glue-files.ts';

function setupTest() {
  return {
    collectPaths: (entry: string): string[] => {
      const plugin = definePlugin({
        name: 'tickets',
        consumers: [
          defineConsumer({
            name: 'ticket_tracker',
            entry: new URL(entry),
            input: { mode: 'fact', streams: [] },
            tables: {},
            entityViews: [],
            reads: [],
            links: [],
          }),
        ],
      });

      const checked = checkBuildTarget({ kind: 'plugin', plugin });

      invariant(checked.ok);

      return collectGlueFiles({ target: checked.value, packageRoot: '/work/tickets' }).map(
        (file) => file.path,
      );
    },
  };
}

test('it puts the glue of a consumer in the generated folder beside its entry folder', () => {
  const ctx = setupTest();

  expect(ctx.collectPaths('file:///work/tickets/src/consumers/ticket-tracker.ts')).toStrictEqual([
    '/work/tickets/src/generated/ticket-tracker-boundary.ts',
    '/work/tickets/src/generated/ticket-tracker.sql',
  ]);
});

test('it leaves out a consumer outside the package', () => {
  const ctx = setupTest();

  expect(ctx.collectPaths('file:///work/other/src/consumers/ticket-tracker.ts')).toStrictEqual([]);
});

test('it leaves out a consumer of a dependency', () => {
  const ctx = setupTest();

  expect(
    ctx.collectPaths('file:///work/tickets/node_modules/dep/src/consumers/ticket-tracker.ts'),
  ).toStrictEqual([]);
});
