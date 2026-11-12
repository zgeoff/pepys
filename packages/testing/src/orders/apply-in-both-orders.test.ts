import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { definePlugin } from '@pepys/kit';
import type { EntityID } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { ledgerAccountConsumer, ledgerPlugin, ledgerSource } from '../ledger/ledger-plugin.ts';
import { applyInBothOrders } from './apply-in-both-orders.ts';

async function setupTest() {
  const directory = await mkdtemp(join(tmpdir(), 'pepys-orders-'));

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return {
    writeEntry: async (text: string): Promise<URL> => {
      const path = join(directory, 'entry.ts');

      await Bun.write(path, text);

      return pathToFileURL(path);
    },
  };
}

test('it reads equal rows and links for the ledger facts applied twice and in both orders', async () => {
  const report = await applyInBothOrders({
    plugins: [ledgerPlugin],
    source: ledgerSource,
    facts: [
      {
        type: 'ledger.account.opened',
        event: 'evt-1',
        entity: 'ledger:account:harbour',
        at: '2026-11-01T09:00:00.000Z',
        payload: { name: 'Harbour fund' },
      },
      {
        type: 'ledger.account.renamed',
        event: 'evt-2',
        entity: 'ledger:account:harbour',
        at: '2026-11-01T09:30:00.000Z',
        payload: { name: 'Quay fund' },
      },
      {
        type: 'ledger.account.renamed',
        event: 'evt-3',
        entity: 'ledger:account:harbour',
        at: '2026-11-01T09:30:00.000Z',
        payload: { name: 'Pier fund' },
      },
      {
        type: 'ledger.entry.posted',
        event: 'evt-4',
        entity: 'ledger:account:harbour',
        at: '2026-11-01T09:10:00.000Z',
        payload: { entry: 'e-1', amount: 40, rate: 1.5, memo: 'Rope', details: { till: 'north' } },
      },
      {
        type: 'ledger.entry.posted',
        event: 'evt-5',
        entity: 'ledger:account:reef',
        at: '2026-11-01T09:20:00.000Z',
        payload: { entry: 'e-2', amount: 7, rate: 1, memo: 'Tar', details: {} },
      },
    ],
  });

  const snapshot = {
    rows: {
      ledger_account: [
        {
          id: 'ledger:account:harbour',
          name: 'Pier fund',
          balance: 40,
          is_closed: false,
          opened_at: '2026-11-01T09:00:00.000Z',
          updated_at: '2026-11-01T09:30:00.000Z',
        },
        {
          id: 'ledger:account:reef',
          name: null,
          balance: 7,
          is_closed: false,
          opened_at: null,
          updated_at: '2026-11-01T09:20:00.000Z',
        },
      ],
      ledger_entry: [
        {
          id: 'ledger:entry:e-1',
          account_id: 'ledger:account:harbour',
          amount: 40,
          rate: 1.5,
          memo: 'Rope',
          details: { till: 'north' },
          posted_at: '2026-11-01T09:10:00.000Z',
        },
        {
          id: 'ledger:entry:e-2',
          account_id: 'ledger:account:reef',
          amount: 7,
          rate: 1,
          memo: 'Tar',
          details: {},
          posted_at: '2026-11-01T09:20:00.000Z',
        },
      ],
    },
    links: [
      {
        type: 'entry_of',
        from_id: toTagged<EntityID>('ledger:entry:e-1'),
        to_id: toTagged<EntityID>('ledger:account:harbour'),
        scope: toTagged<EntityID>('ledger:account:harbour'),
        origin: 'ledger_account',
        confidence: 1,
        evidence: 'event:ledger:evt-4',
      },
      {
        type: 'entry_of',
        from_id: toTagged<EntityID>('ledger:entry:e-2'),
        to_id: toTagged<EntityID>('ledger:account:reef'),
        scope: toTagged<EntityID>('ledger:account:reef'),
        origin: 'ledger_account',
        confidence: 1,
        evidence: 'event:ledger:evt-5',
      },
    ],
  };

  expect(report).toStrictEqual({ given: snapshot, reversed: snapshot, isSame: true });
});

test('it finds that a consumer with no tie-break on equal times differs between the orders', async () => {
  const ctx = await setupTest();

  // the last rename in the host's order wins, so arrival order decides between equal times
  const entry = await ctx.writeEntry(`
declare function readScopeFactsLength(scope: string): number;
declare function readScopeFactsInto(scope: string, facts: Uint8Array): void;

export function applyScope(scope: string): string {
  const buffer = new Uint8Array(readScopeFactsLength(scope));

  readScopeFactsInto(scope, buffer);

  let name = null;
  let at = '';

  for (const fact of JSON.parse(new TextDecoder().decode(buffer))) {
    name = fact.payload.name;
    at = fact.at;
  }

  return JSON.stringify([
    { upsert: { ledger_account: { id: scope, name, balance: 0, is_closed: false, opened_at: null, updated_at: at } } },
  ]);
}
`);

  const report = await applyInBothOrders({
    plugins: [
      definePlugin({
        name: 'ledger',
        sources: [ledgerSource],
        consumers: [{ ...ledgerAccountConsumer, entry }],
      }),
    ],
    source: ledgerSource,
    facts: [
      {
        type: 'ledger.account.renamed',
        event: 'evt-2',
        entity: 'ledger:account:harbour',
        at: '2026-11-01T09:30:00.000Z',
        payload: { name: 'Quay fund' },
      },
      {
        type: 'ledger.account.renamed',
        event: 'evt-3',
        entity: 'ledger:account:harbour',
        at: '2026-11-01T09:30:00.000Z',
        payload: { name: 'Pier fund' },
      },
    ],
  });

  expect(report.isSame).toBeFalse();
});
