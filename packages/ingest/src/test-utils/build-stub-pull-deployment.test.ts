import { expect, test } from 'bun:test';
import { buildStubPullDeployment } from './build-stub-pull-deployment.ts';

test('it builds a checked deployment with one source per name, its two streams and its pull paths', () => {
  const deployment = buildStubPullDeployment({
    almanac: {
      live: { intervalMs: 5, pull: () => Promise.resolve({ kind: 'expired' }) },
      backfill: { intervalMs: null, pull: () => Promise.resolve({ kind: 'expired' }) },
    },
    tally: {},
  });

  const sources = deployment.sources.map((source) => ({
    name: source.name,
    streams: source.families.map((family) => family.stream),
    live: source.live,
    backfill: source.backfill,
  }));

  expect(sources).toStrictEqual([
    {
      name: 'almanac',
      streams: ['facts.almanac.tide', 'facts.almanac.moon'],
      live: { kind: 'pull', name: 'live', intervalMs: 5, pull: expect.any(Function) },
      backfill: { kind: 'pull', name: 'backfill', intervalMs: null, pull: expect.any(Function) },
    },
    {
      name: 'tally',
      streams: ['facts.tally.tide', 'facts.tally.moon'],
      live: undefined,
      backfill: undefined,
    },
  ]);
});
