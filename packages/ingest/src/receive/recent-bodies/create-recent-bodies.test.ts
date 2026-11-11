import { expect, test } from 'bun:test';
import type { EntityID } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { createRecentBodies } from './create-recent-bodies.ts';

function setupTest() {
  const clock = { nowMs: 0 };

  return {
    clock,
    bodies: createRecentBodies({ capacity: 2, maxAgeMs: 3_600_000, now: () => clock.nowMs }),
  };
}

test('it finds a body it remembered under the same key', () => {
  const ctx = setupTest();
  const entities = [toTagged<EntityID>('ledger:till:7')];

  ctx.bodies.remember('digest-a', { stored: 2, entities });

  expect(ctx.bodies.find('digest-a')).toStrictEqual({ stored: 2, entities });
});

test('it forgets a body an hour after it remembered it', () => {
  const ctx = setupTest();

  ctx.bodies.remember('digest-a', { stored: 2, entities: [] });

  ctx.clock.nowMs = 3_600_000;

  expect(ctx.bodies.find('digest-a')).toBeUndefined();
});

test('it still finds a body one millisecond before the hour ends', () => {
  const ctx = setupTest();

  ctx.bodies.remember('digest-a', { stored: 2, entities: [] });

  ctx.clock.nowMs = 3_599_999;

  expect(ctx.bodies.find('digest-a')).toStrictEqual({ stored: 2, entities: [] });
});

test('it drops the oldest body when it holds more than its capacity', () => {
  const ctx = setupTest();

  ctx.bodies.remember('digest-a', { stored: 1, entities: [] });
  ctx.bodies.remember('digest-b', { stored: 1, entities: [] });
  ctx.bodies.remember('digest-c', { stored: 1, entities: [] });

  expect([
    ctx.bodies.find('digest-a'),
    ctx.bodies.find('digest-b'),
    ctx.bodies.find('digest-c'),
  ]).toStrictEqual([undefined, { stored: 1, entities: [] }, { stored: 1, entities: [] }]);
});
