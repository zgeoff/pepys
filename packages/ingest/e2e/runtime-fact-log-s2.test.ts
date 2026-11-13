import { expect, test } from 'bun:test';
import { createS2FactLog } from '@pepys/ingest';
import invariant from 'tiny-invariant';
import { readFactLogFixtures, runFactLogFixture } from '../src/fact-log/run-fact-log-fixture.ts';

function setupTest() {
  const endpoint = process.env['PEPYS_S2_ENDPOINT'];
  const accessToken = process.env['PEPYS_S2_ACCESS_TOKEN'];

  invariant(
    endpoint !== undefined && accessToken !== undefined,
    'the e2e preload sets the s2 address',
  );

  return { endpoint, accessToken };
}

test.each(readFactLogFixtures().map((fixture) => [fixture.title, fixture] as const))(
  'it %s, on s2-lite',
  async (_title, fixture) => {
    const ctx = setupTest();

    const log = await createS2FactLog({
      endpoint: ctx.endpoint,
      accessToken: ctx.accessToken,
      basin: `conformance-${fixture.name}`,
      streams: fixture.streams,
    });

    const returned = await runFactLogFixture(log, fixture);

    expect(returned).toStrictEqual(fixture.calls.map((call) => call.returns));
  },
);
