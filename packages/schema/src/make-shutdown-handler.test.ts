import { expect, mock, test } from 'bun:test';
import { makeShutdownHandler } from './make-shutdown-handler.ts';

test('it stops once and exits with 0 when a second signal arrives during shutdown', async () => {
  const stop = mock(() => Promise.resolve());
  const exit = mock<(code: number) => void>();
  const shutdown = makeShutdownHandler({ stop, logError: () => {}, exit });

  await Promise.all([shutdown(), shutdown()]);

  expect(stop).toHaveBeenCalledOnce();
  expect(exit).toHaveBeenCalledExactlyOnceWith(0);
});

test('it logs a failed stop and exits with 1', async () => {
  const failure = new Error('the store did not close');

  const logError = mock<(message: string, error: unknown) => void>();
  const exit = mock<(code: number) => void>();
  const shutdown = makeShutdownHandler({ stop: () => Promise.reject(failure), logError, exit });

  await shutdown();

  expect(logError).toHaveBeenCalledExactlyOnceWith('shutdown failed', failure);
  expect(exit).toHaveBeenCalledExactlyOnceWith(1);
});
