import { expect, onTestFinished, test } from 'bun:test';
import { waitFor } from '@zgeoff/testing/helpers';
import { createHostProcess } from './create-host-process.ts';

function setupTest(argv: readonly string[]) {
  const host = createHostProcess(() =>
    Bun.spawn([...argv], { stdout: 'ignore', stderr: 'ignore' }),
  );

  onTestFinished(() => host.stop());

  return { host };
}

test('it runs the host after a start, counting one start', () => {
  const ctx = setupTest(['sleep', '30']);

  ctx.host.start();

  expect({ state: ctx.host.state(), starts: ctx.host.starts() }).toStrictEqual({
    state: 'running',
    starts: 1,
  });
});

test('it stops a running host with SIGTERM and returns its exit code', async () => {
  const ctx = setupTest(['sleep', '30']);

  ctx.host.start();

  const exitCode = await ctx.host.stop();

  expect(exitCode).toBe(128 + 15);
});

test('it returns null for the stop of a host that is not running', async () => {
  const ctx = setupTest(['sleep', '30']);

  const exitCode = await ctx.host.stop();

  expect(exitCode).toBeNull();
});

test('it starts the host again after a stop, counting two starts', async () => {
  const ctx = setupTest(['sleep', '30']);

  ctx.host.start();

  await ctx.host.stop();

  ctx.host.start();

  expect({ state: ctx.host.state(), starts: ctx.host.starts() }).toStrictEqual({
    state: 'running',
    starts: 2,
  });
});

test('it reports the host stopped once it exits on its own', async () => {
  const ctx = setupTest(['sh', '-c', 'exit 3']);

  ctx.host.start();

  await waitFor(() => {
    expect(ctx.host.state()).toBe('stopped');
  });
});
