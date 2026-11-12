import { expect, test } from 'bun:test';
import { defineConsumer, definePlugin } from '@pepys/kit';
import type { TargetFailure } from './pick-build-target.ts';
import { pickCheckedTarget } from './pick-checked-target.ts';

test.each<[string, unknown, TargetFailure]>([
  ['a value that is no module', 'not a module', 'no-target'],
  ['a module with no target', { version: 3 }, 'no-target'],
  [
    'a module with two targets',
    { tide: definePlugin({ name: 'tide' }), berth: definePlugin({ name: 'berth' }) },
    'several-targets',
  ],
])('it refuses %s', (_title, loaded, reason) => {
  expect(pickCheckedTarget(loaded)).toStrictEqual({
    ok: false,
    failure: { kind: 'no-target', reason },
  });
});

test('it refuses a plug-in that fails its check, with each failure', () => {
  const consumer = defineConsumer({
    name: 'tide_log',
    entry: new URL('file:///stub/consumers/tide-log.ts'),
    input: { mode: 'fact', streams: [] },
    tables: {},
    entityViews: [],
    reads: [],
    links: [],
  });

  const plugin = definePlugin({ name: 'tide', consumers: [consumer, consumer] });

  expect(pickCheckedTarget({ plugin })).toStrictEqual({
    ok: false,
    failure: {
      kind: 'invalid',
      failures: [
        { kind: 'duplicate', of: 'consumer', name: 'tide_log', plugins: ['tide', 'tide'] },
      ],
    },
  });
});

test('it gives the checked plug-in of a module that exports one', () => {
  const plugin = definePlugin({ name: 'tide' });

  expect(pickCheckedTarget({ default: plugin })).toStrictEqual({
    ok: true,
    value: {
      deployment: null,
      checked: {
        name: 'tide',
        sources: [],
        consumers: [],
        queries: [],
        entityKinds: [],
        linkTypes: [],
        settings: {},
      },
      plugins: [plugin],
    },
  });
});
