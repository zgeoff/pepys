import { expect, test } from 'bun:test';
import { defineSource } from '../sources/define-source.ts';
import { receiveFactBatch } from '../sources/receive-fact-batch.ts';
import { definePlugin } from './define-plugin.ts';
import { listReceiveRoutes } from './list-receive-routes.ts';

test('it lists each receive route with its check and reach, the ignored routes included', () => {
  const ledgerSource = defineSource({
    name: 'ledger',
    families: [],
    live: receiveFactBatch({
      route: '/ledger/facts',
      check: { kind: 'hmac-sha256', header: 'x-ledger-signature-256', secretEnv: 'LEDGER_SECRET' },
      reach: 'public',
    }),
  });

  const meterSource = defineSource({
    name: 'meter',
    families: [],
    live: {
      ...receiveFactBatch({
        route: '/v1/logs',
        check: { kind: 'token', header: 'authorization', secretEnv: 'METER_TOKEN' },
      }),
      ignoredRoutes: ['/v1/metrics', '/v1/traces'],
    },
  });

  const rosterSource = defineSource({
    name: 'roster',
    families: [],
    live: {
      kind: 'pull',
      name: 'roster',
      intervalMs: 60_000,
      pull: () => Promise.resolve({ kind: 'expired' }),
    },
  });

  const deployment = {
    name: 'harbour',
    plugins: [
      definePlugin({ name: 'ledger', sources: [ledgerSource] }),
      definePlugin({ name: 'meter', sources: [meterSource, rosterSource] }),
    ],
  };

  expect(listReceiveRoutes(deployment)).toStrictEqual([
    {
      source: 'ledger',
      route: '/ledger/facts',
      check: 'hmac-sha256',
      reach: 'public',
      stores: true,
    },
    { source: 'meter', route: '/v1/logs', check: 'token', reach: 'private', stores: true },
    { source: 'meter', route: '/v1/metrics', check: 'token', reach: 'private', stores: false },
    { source: 'meter', route: '/v1/traces', check: 'token', reach: 'private', stores: false },
  ]);
});
