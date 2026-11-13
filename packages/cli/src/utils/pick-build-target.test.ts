import { expect, test } from 'bun:test';
import { defineDeployment, definePlugin } from '@pepys/kit';
import { pickBuildTarget } from './pick-build-target.ts';

function setupTest() {
  return {
    plugin: definePlugin({ name: 'tickets' }),
    other: definePlugin({ name: 'notes' }),
  };
}

test('it picks a plug-in by any export name', () => {
  const ctx = setupTest();

  expect(pickBuildTarget({ ticketsPlugin: ctx.plugin, version: 3 })).toStrictEqual({
    ok: true,
    value: { kind: 'plugin', plugin: ctx.plugin },
  });
});

test('it picks a deployment', () => {
  const ctx = setupTest();
  const deployment = defineDeployment({ name: 'home', plugins: [ctx.plugin] });

  expect(pickBuildTarget({ deployment })).toStrictEqual({
    ok: true,
    value: { kind: 'deployment', deployment },
  });
});

test('it counts a value exported twice once', () => {
  const ctx = setupTest();

  expect(pickBuildTarget({ default: ctx.plugin, plugin: ctx.plugin })).toStrictEqual({
    ok: true,
    value: { kind: 'plugin', plugin: ctx.plugin },
  });
});

test('it refuses a file with no target', () => {
  expect(pickBuildTarget({ value: 1, name: 'x' })).toStrictEqual({
    ok: false,
    failure: 'no-target',
  });
});

test('it refuses a file with two targets', () => {
  const ctx = setupTest();

  expect(pickBuildTarget({ plugin: ctx.plugin, other: ctx.other })).toStrictEqual({
    ok: false,
    failure: 'several-targets',
  });
});
