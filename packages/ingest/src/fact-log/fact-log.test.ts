import { expect, test } from 'bun:test';
import { createMemoryFactLog } from './memory/create-memory-fact-log.ts';
import { readFactLogFixtures, runFactLogFixture } from './run-fact-log-fixture.ts';

test.each(readFactLogFixtures().map((fixture) => [fixture.title, fixture] as const))(
  'it %s, on the memory log',
  async (_title, fixture) => {
    const log = createMemoryFactLog(fixture.streams);

    const returned = await runFactLogFixture(log, fixture);

    expect(returned).toStrictEqual(fixture.calls.map((call) => call.returns));
  },
);
