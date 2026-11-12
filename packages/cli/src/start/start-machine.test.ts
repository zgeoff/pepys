import { expect, test } from 'bun:test';
import { createActor, toPromise } from 'xstate';
import type { StartEvent } from './start-machine.ts';
import { startMachine } from './start-machine.ts';

function setupTest(stopParts: () => Promise<boolean>) {
  const actor = createActor(startMachine, { input: { stopParts } });

  actor.start();

  return {
    send: (event: StartEvent) => actor.send(event),
    readExitCode: () => toPromise(actor),
  };
}

test('it exits 0 on a stop signal after every part stopped cleanly', async () => {
  const ctx = setupTest(() => Promise.resolve(true));

  ctx.send({ type: 'signal' });

  const exitCode = await ctx.readExitCode();

  expect(exitCode).toBe(0);
});

test('it exits 1 on a stop signal when a part did not stop cleanly', async () => {
  const ctx = setupTest(() => Promise.resolve(false));

  ctx.send({ type: 'signal' });

  const exitCode = await ctx.readExitCode();

  expect(exitCode).toBe(1);
});

test('it exits 1 on a stop signal when stopping the parts throws', async () => {
  const ctx = setupTest(() => Promise.reject(new Error('the host would not stop')));

  ctx.send({ type: 'signal' });

  const exitCode = await ctx.readExitCode();

  expect(exitCode).toBe(1);
});

test('it exits 1 when a part ends on its own, though every part then stops cleanly', async () => {
  const ctx = setupTest(() => Promise.resolve(true));

  ctx.send({ type: 'part-ended' });

  const exitCode = await ctx.readExitCode();

  expect(exitCode).toBe(1);
});

test('it stops the parts once when a signal follows an ended part', async () => {
  const stops: string[] = [];

  const ctx = setupTest(() => {
    stops.push('stop');

    return Promise.resolve(true);
  });

  ctx.send({ type: 'part-ended' });
  ctx.send({ type: 'signal' });

  await ctx.readExitCode();

  expect(stops).toStrictEqual(['stop']);
});
