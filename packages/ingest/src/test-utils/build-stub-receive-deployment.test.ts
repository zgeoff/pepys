import { expect, test } from 'bun:test';
import type { Sender } from '@pepys/kit';
import invariant from 'tiny-invariant';
import { buildStubReceiveDeployment } from './build-stub-receive-deployment.ts';

function setupTest() {
  const stub = buildStubReceiveDeployment();
  const beacon = stub.deployment.sources.find((source) => source.name === 'beacon')?.live;

  invariant(beacon?.kind === 'receive', 'the beacon source has a receive path');

  return {
    stub,
    readBeacon: (body: string, sender: Sender) =>
      beacon.read(
        { headers: new Headers(), body: new TextEncoder().encode(body), sender },
        { name: 'beacon', families: [] },
      ),
  };
}

test('it builds a checked deployment of the three stub sources', () => {
  const ctx = setupTest();

  const routes = ctx.stub.deployment.sources.map((source) =>
    source.live?.kind === 'receive' ? source.live.route : null,
  );

  expect(routes).toStrictEqual(['/ledger/facts', '/beacon/readings', '/stray/notes']);
});

test('it gives the beacon path a reader that puts the proven sender in place of the origin in the body', () => {
  const ctx = setupTest();

  const received: unknown = ctx.readBeacon(
    JSON.stringify({
      readings: [
        { lamp: 'north', at: '2026-10-01T08:00:00Z', level: 3, origin: { subject: 'worker-9' } },
      ],
    }),
    { issuer: 'https://id.example', subject: 'worker-4', name: 'worker four' },
  );

  expect(received).toStrictEqual({
    kind: 'batch',
    batch: {
      facts: [
        {
          stream: 'facts.beacon.lamp',
          blobs: [],
          fact: {
            id: 'event:beacon:north-2026-10-01T08:00:00Z',
            type: 'beacon.lamp.lit',
            v: 1,
            api: 'beacon/1',
            entity: 'beacon:lamp:north',
            at: '2026-10-01T08:00:00Z',
            payload: { level: 3, origin: { issuer: 'https://id.example', subject: 'worker-4' } },
          },
        },
      ],
    },
  });
});
