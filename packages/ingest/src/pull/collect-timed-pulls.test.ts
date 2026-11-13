import { expect, test } from 'bun:test';
import { buildStubPullDeployment } from '../test-utils/build-stub-pull-deployment.ts';
import { collectTimedPulls } from './collect-timed-pulls.ts';

test('it lists each pull path that sets an interval, and leaves out a path with none', () => {
  const deployment = buildStubPullDeployment({
    almanac: {
      resync: { intervalMs: 60_000, pull: () => Promise.resolve({ kind: 'expired' }) },
      backfill: { intervalMs: null, pull: () => Promise.resolve({ kind: 'expired' }) },
      live: { intervalMs: 5000, pull: () => Promise.resolve({ kind: 'expired' }) },
    },
    tally: {
      recovery: { intervalMs: 3_600_000, pull: () => Promise.resolve({ kind: 'expired' }) },
    },
  });

  const pulls = collectTimedPulls(deployment.sources);

  expect(pulls).toStrictEqual([
    { source: 'almanac', path: 'live', intervalMs: 5000 },
    { source: 'almanac', path: 'resync', intervalMs: 60_000 },
    { source: 'tally', path: 'recovery', intervalMs: 3_600_000 },
  ]);
});
