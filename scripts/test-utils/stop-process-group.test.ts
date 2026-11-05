import { expect, onTestFinished, test } from 'bun:test';
import { stopProcessGroup } from './stop-process-group.ts';

function setupTest() {
  return {
    runChild: (command: string[]) => {
      const child = Bun.spawn(command, { stdout: 'ignore', stderr: 'ignore', detached: true });

      onTestFinished(() => stopProcessGroup(child));

      return child;
    },
  };
}

test('it ends a running child with SIGTERM', async () => {
  const ctx = setupTest();
  const child = ctx.runChild(['sleep', '30']);

  await stopProcessGroup(child);

  expect({ exitCode: child.exitCode, signalCode: child.signalCode }).toStrictEqual({
    exitCode: null,
    signalCode: 'SIGTERM',
  });
});

test('it resolves when the child and its group are already gone', async () => {
  const ctx = setupTest();
  const child = ctx.runChild(['true']);

  await child.exited;

  await expect(stopProcessGroup(child)).toResolve();
});
