import { expect, onTestFinished, test } from 'bun:test';
import { createStoreReader, readOffsets } from '@pepys/api';
import type { StreamName } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { ledgerAccountConsumer } from '../packages/testing/src/ledger/ledger-plugin.ts';

// The setup appends the ledger journey's records to s2-lite before `pepys up`, so the host's scope
// batch has run the compiled ledger module on them.
function setupTest() {
  const storeDirectory = process.env['PEPYS_STORE_DIR'];

  invariant(
    storeDirectory !== undefined,
    'run the e2e lane with bun run test:e2e, which preloads e2e/start-stack.ts',
  );

  const store = createStoreReader({ storeDirectory });

  onTestFinished(() => store.close());

  return {
    readAccounts: () =>
      store.withConsumers([ledgerAccountConsumer], (db) =>
        db
          .selectFrom('ledger_account')
          .select(['id', 'name', 'balance', 'is_closed'])
          .orderBy('id')
          .execute(),
      ),
    readLinks: () =>
      store.withConsumers([ledgerAccountConsumer], (db) =>
        db
          .selectFrom('link_effective')
          .select(['type', 'from_id', 'to_id', 'evidence'])
          .orderBy('from_id')
          .execute(),
      ),
    readOffsets: () => readOffsets(store, ledgerAccountConsumer),
  };
}

test('it stores the accounts that the compiled scope module computes from the ledger journey', async () => {
  const ctx = setupTest();

  const result: unknown = await ctx.readAccounts();

  expect(result).toStrictEqual({
    ok: true,
    value: [
      { id: 'ledger:account:a', name: 'Alpha trust', balance: 5, is_closed: 0 },
      { id: 'ledger:account:b', name: 'Beta', balance: 7, is_closed: 1 },
    ],
  });
});

test('it stores a link from each posted entry to its account', async () => {
  const ctx = setupTest();

  const result: unknown = await ctx.readLinks();

  expect(result).toStrictEqual({
    ok: true,
    value: [
      {
        type: 'entry_of',
        from_id: 'ledger:entry:e-1',
        to_id: 'ledger:account:a',
        evidence: 'event:ledger:evt-2',
      },
      {
        type: 'entry_of',
        from_id: 'ledger:entry:e-2',
        to_id: 'ledger:account:b',
        evidence: 'event:ledger:evt-6',
      },
    ],
  });
});

test("it records the ledger stream's last sequence number as the scope consumer's offset", async () => {
  const ctx = setupTest();

  const result = await ctx.readOffsets();

  expect(result).toStrictEqual({
    ok: true,
    value: [{ stream: toTagged<StreamName>('facts.ledger.account'), lastSeqNum: 7 }],
  });
});
