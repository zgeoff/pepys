import { expect, test } from 'bun:test';
import invariant from 'tiny-invariant';

// The preload runs `pepys run` until every consumer has applied the journeys, and keeps its stderr.
// The host prints each error of `run`, a stopped consumer task included, on a line that starts with
// `pepys: `, and goes on running the other tasks.
function setupTest() {
  const runStderrPath = process.env['PEPYS_E2E_RUN_STDERR'];

  invariant(
    runStderrPath !== undefined,
    'run the e2e lane with bun run test:e2e, which preloads packages/cli/e2e/start-stack.ts',
  );

  return {
    readHostErrors: async () => {
      const text = await Bun.file(runStderrPath).text();

      return text.split('\n').filter((line) => line.startsWith('pepys: '));
    },
  };
}

test('it stops no consumer task while pepys run applies the journeys', async () => {
  const ctx = setupTest();

  const errors = await ctx.readHostErrors();

  expect(errors).toStrictEqual([]);
});
