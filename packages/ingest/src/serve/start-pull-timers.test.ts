import { expect, onTestFinished, test } from 'bun:test';
import {
  checkDeployment,
  createLogger,
  defineDeployment,
  defineFactFamily,
  definePlugin,
  defineSource,
} from '@pepys/kit';
import type { PullPath } from '@pepys/kit';
import { waitFor } from '@zgeoff/testing/helpers';
import invariant from 'tiny-invariant';
import { z } from 'zod';
import { createMemoryFactLog } from '../fact-log/memory/create-memory-fact-log.ts';
import { createIngest } from '../receive/create-ingest.ts';
import { noSenderProof } from '../sender-proof/none/no-sender-proof.ts';
import { startPullTimers } from './start-pull-timers.ts';

function setupTest() {
  const lines: string[] = [];
  const logger = createLogger({ write: (line) => lines.push(line) });

  return {
    readLogged: () => lines.map((line): unknown => JSON.parse(line)),
    startTimers: (pull: PullPath['pull']) => {
      const source = defineSource({
        name: 'almanac',
        families: [
          defineFactFamily({
            stream: 'facts.almanac.tide',
            api: 'almanac/1',
            entityKind: 'almanac:tide',
            types: { 'almanac.tide.turned': z.object({}) },
          }),
        ],
        live: { kind: 'pull', name: 'tides', intervalMs: 1, pull },
      });

      const deployment = checkDeployment(
        defineDeployment({
          name: 'quay',
          plugins: [definePlugin({ name: 'almanac', sources: [source] })],
        }),
      );

      invariant(deployment.ok, 'the deployment passes the check');

      const ingest = createIngest({
        deployment: deployment.value,
        secrets: {},
        log: createMemoryFactLog([]),
        senderProof: noSenderProof,
        appendRetry: { maxAttempts: 1, retryDelayMs: 0 },
        now: () => 0,
        logger,
      });

      const stop = startPullTimers(deployment.value.sources, ingest.runPull, logger);

      onTestFinished(stop);

      return stop;
    },
  };
}

test('it logs a timed pull that stores nothing, with what the pull answered', async () => {
  const ctx = setupTest();

  ctx.startTimers(() => Promise.resolve({ kind: 'unavailable', retryAfterMs: 30_000 }));

  await waitFor(() => {
    expect(ctx.readLogged()[0]).toStrictEqual({
      level: 'error',
      message: 'the live pull of almanac did not store',
      detail: { kind: 'unavailable', retryAfterMs: 30_000 },
    });
  });
});

test('it logs a timed pull that throws, with its error', async () => {
  const ctx = setupTest();

  ctx.startTimers(() => Promise.reject(new Error('the tide table is offline')));

  await waitFor(() => {
    expect(ctx.readLogged()[0]).toStrictEqual({
      level: 'error',
      message: 'the live pull of almanac threw',
      detail: { name: 'Error', message: 'the tide table is offline', stack: expect.any(String) },
    });
  });
});

test('it aborts a pull in flight on stop, and settles once the pull ends', async () => {
  const ctx = setupTest();
  const seen = Promise.withResolvers<AbortSignal>();
  const ended: string[] = [];

  const stop = ctx.startTimers(async (_cursor, context) => {
    seen.resolve(context.signal);

    await new Promise((resolve) => {
      context.signal.addEventListener('abort', resolve);
    });

    ended.push('pull');

    return { kind: 'unavailable', retryAfterMs: 1 };
  });

  const signal = await seen.promise;

  await stop();

  expect({ isAborted: signal.aborted, ended }).toStrictEqual({ isAborted: true, ended: ['pull'] });
});

test('it logs no failure for a pull that the stop cut short', async () => {
  const ctx = setupTest();
  const seen = Promise.withResolvers<void>();

  const stop = ctx.startTimers(async (_cursor, context) => {
    seen.resolve();

    await new Promise((resolve) => {
      context.signal.addEventListener('abort', resolve);
    });

    return { kind: 'unavailable', retryAfterMs: 1 };
  });

  await seen.promise;
  await stop();

  expect(ctx.readLogged()).toStrictEqual([]);
});

test('it logs no failure for a pull that throws once the stop aborted it', async () => {
  const ctx = setupTest();
  const seen = Promise.withResolvers<void>();

  const stop = ctx.startTimers(async (_cursor, context) => {
    seen.resolve();

    await new Promise((resolve) => {
      context.signal.addEventListener('abort', resolve);
    });

    throw new Error('the tide table read was aborted');
  });

  await seen.promise;
  await stop();

  expect(ctx.readLogged()).toStrictEqual([]);
});
