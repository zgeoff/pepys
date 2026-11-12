import { expect, test } from 'bun:test';
import { createTestStore } from '../test-store/create-test-store.ts';
import { parseAppliedFacts } from '../test-store/parse-applied-facts.ts';
import type { AppliedFact } from '../test-store/types.ts';
import journey from './ledger-journey.json' with { type: 'json' };
import { ledgerPlugin, ledgerSource } from './ledger-plugin.ts';

// The Rust e2e lane runs the journey's records through the compiled ledger module and expects its
// rows and links. Two renames share one time, a posted entry arrives twice, and the times hold
// fractions of three lengths.
function setupTest() {
  const posted = {
    type: 'ledger.entry.posted',
    event: 'evt-2',
    entity: 'ledger:account:a',
    at: '2026-11-01T09:30:00.5Z',
    payload: { entry: 'e-1', amount: 5, rate: 2, memo: 'Rope', details: { till: 'north' } },
  } as const;

  const batches: AppliedFact<typeof ledgerSource>[][] = [
    [
      {
        type: 'ledger.account.opened',
        event: 'evt-1',
        entity: 'ledger:account:a',
        at: '2026-11-01T09:00:00Z',
        payload: { name: 'Alpha' },
      },
      posted,
      {
        type: 'ledger.account.opened',
        event: 'evt-3',
        entity: 'ledger:account:b',
        at: '2026-11-01T09:00:00Z',
        payload: { name: 'Beta' },
      },
      {
        type: 'ledger.account.renamed',
        event: 'evt-5',
        entity: 'ledger:account:a',
        at: '2026-11-01T10:00:00Z',
        payload: { name: 'Alpha trust' },
      },
      {
        type: 'ledger.account.renamed',
        event: 'evt-4',
        entity: 'ledger:account:a',
        at: '2026-11-01T10:00:00Z',
        payload: { name: 'Alpha fund' },
      },
    ],
    [
      posted,
      {
        type: 'ledger.entry.posted',
        event: 'evt-6',
        entity: 'ledger:account:b',
        at: '2026-11-01T09:30:00.25Z',
        payload: { entry: 'e-2', amount: 7, rate: 1.25, memo: 'Sail', details: {} },
      },
      {
        type: 'ledger.account.closed',
        event: 'evt-7',
        entity: 'ledger:account:b',
        at: '2026-11-01T11:00:00.123Z',
        payload: {},
      },
    ],
  ];

  return {
    readRecords: () =>
      batches.flatMap((batch) => {
        const parsed = parseAppliedFacts(ledgerSource, batch, undefined);

        return parsed.ok
          ? parsed.value.map((fact) => ({
              stream: fact.stream,
              body: JSON.stringify(fact.envelope),
            }))
          : [];
      }),
    readJourney: async () => {
      await using store = await createTestStore({ plugins: [ledgerPlugin] });

      for (const batch of batches) {
        await store.apply(ledgerSource, batch);
      }

      return {
        rows: {
          ledger_account: await store.readRows('ledger_account'),
          ledger_entry: await store.readRows('ledger_entry'),
        },
        links: await store.readLinks(),
      };
    },
  };
}

test('it holds the records that ingest stores for the facts of the ledger journey', () => {
  const ctx = setupTest();
  const records = ctx.readRecords();

  expect(records).toStrictEqual(journey.records);
});

test('it holds the rows and links that the test store gives for the ledger journey', async () => {
  const ctx = setupTest();

  const received: unknown = await ctx.readJourney();

  expect(received).toStrictEqual({ rows: journey.rows, links: journey.links });
});
