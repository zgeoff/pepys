import { expect, test } from 'bun:test';
import { z } from 'zod';
import { defineFactFamily } from './define-fact-family.ts';
import { receiveFactBatch } from './receive-fact-batch.ts';
import type { Delivery } from './types.ts';

function setupTest() {
  const tillFamily = defineFactFamily({
    stream: 'facts.ledger.till',
    api: 'ledger/1',
    entityKind: 'ledger:till',
    types: {
      'ledger.till.opened': z.object({ float: z.number() }),
      'ledger.till.closed': z.object({ takings: z.number() }),
    },
  });

  const path = receiveFactBatch({
    route: '/ledger/facts',
    check: { kind: 'hmac-sha256', header: 'x-ledger-signature-256', secretEnv: 'LEDGER_SECRET' },
  });

  return {
    path,
    readBody: (body: string) => {
      const delivery: Delivery = { headers: new Headers(), body: new TextEncoder().encode(body) };

      return path.read(delivery, { name: 'ledger', families: [tillFamily] });
    },
  };
}

test('it makes a receive path with the route and the check it is given', () => {
  const ctx = setupTest();

  expect(ctx.path).toStrictEqual({
    kind: 'receive',
    route: '/ledger/facts',
    check: { kind: 'hmac-sha256', header: 'x-ledger-signature-256', secretEnv: 'LEDGER_SECRET' },
    read: expect.any(Function),
  });
});

test('it builds each fact with an event fact ID on its family stream', () => {
  const ctx = setupTest();

  const body = JSON.stringify({
    v: 1,
    facts: [
      {
        type: 'ledger.till.opened',
        event: 'evt-0001',
        entity: 'ledger:till:4',
        actor: 'ledger:clerk:9',
        at: '2026-10-24T01:02:03Z',
        payload: { float: 50, note: 'kept as sent' },
      },
      {
        type: 'ledger.till.closed',
        event: 'evt-0002',
        entity: 'ledger:till:4',
        at: '2026-10-24T09:02:03Z',
        payload: { takings: 812.5 },
      },
    ],
  });

  const actual: unknown = ctx.readBody(body);

  expect(actual).toStrictEqual({
    kind: 'batch',
    batch: {
      facts: [
        {
          stream: 'facts.ledger.till',
          fact: {
            id: 'event:ledger:evt-0001',
            type: 'ledger.till.opened',
            v: 1,
            api: 'ledger/1',
            entity: 'ledger:till:4',
            actor: 'ledger:clerk:9',
            at: '2026-10-24T01:02:03Z',
            payload: { float: 50, note: 'kept as sent' },
          },
          blobs: [],
        },
        {
          stream: 'facts.ledger.till',
          fact: {
            id: 'event:ledger:evt-0002',
            type: 'ledger.till.closed',
            v: 1,
            api: 'ledger/1',
            entity: 'ledger:till:4',
            at: '2026-10-24T09:02:03Z',
            payload: { takings: 812.5 },
          },
          blobs: [],
        },
      ],
    },
  });
});

test('it ignores a batch with no facts', () => {
  const ctx = setupTest();

  expect(ctx.readBody(JSON.stringify({ v: 1, facts: [] }))).toStrictEqual({ kind: 'ignored' });
});

test('it refuses a body that is not JSON with 400', () => {
  const ctx = setupTest();

  expect(ctx.readBody('{"v":1,')).toStrictEqual({
    kind: 'refused',
    status: 400,
    reason: expect.any(String),
  });
});

test.each([
  ['a batch of another version', { v: 2, facts: [] }],
  [
    'a fact type no family of the source has',
    {
      v: 1,
      facts: [
        {
          type: 'ledger.till.lost',
          event: 'evt-1',
          entity: 'ledger:till:4',
          at: '2026-10-24T01:02:03Z',
          payload: {},
        },
      ],
    },
  ],
  [
    'a payload that fails its fact type schema',
    {
      v: 1,
      facts: [
        {
          type: 'ledger.till.opened',
          event: 'evt-1',
          entity: 'ledger:till:4',
          at: '2026-10-24T01:02:03Z',
          payload: { float: 'fifty' },
        },
      ],
    },
  ],
  [
    'an entity of a kind other than the family kind',
    {
      v: 1,
      facts: [
        {
          type: 'ledger.till.opened',
          event: 'evt-1',
          entity: 'ledger:clerk:9',
          at: '2026-10-24T01:02:03Z',
          payload: { float: 50 },
        },
      ],
    },
  ],
  [
    'a fact with no event ID',
    {
      v: 1,
      facts: [
        {
          type: 'ledger.till.opened',
          event: '',
          entity: 'ledger:till:4',
          at: '2026-10-24T01:02:03Z',
          payload: { float: 50 },
        },
      ],
    },
  ],
])('it refuses %s with 422', (_label, body) => {
  const ctx = setupTest();

  expect(ctx.readBody(JSON.stringify(body))).toStrictEqual({
    kind: 'refused',
    status: 422,
    reason: expect.any(String),
  });
});
