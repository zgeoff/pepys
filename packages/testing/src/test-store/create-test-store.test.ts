import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { definePlugin } from '@pepys/kit';
import type { EntityID } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import {
  ledgerAccountConsumer,
  ledgerPlugin,
  ledgerSource,
} from '../test-utils/ledger/ledger-plugin.ts';
import {
  notebookCountQuery,
  notebookNoteConsumer,
  notebookPlugin,
  notebookPurgeQuery,
  notebookSource,
} from '../test-utils/notebook/notebook-plugin.ts';
import { createTestStore } from './create-test-store.ts';

async function setupTest() {
  const directory = await mkdtemp(join(tmpdir(), 'pepys-test-store-'));

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return {
    writeEntry: async (name: string, text: string): Promise<URL> => {
      const path = join(directory, `${name}.ts`);

      await Bun.write(path, text);

      return pathToFileURL(path);
    },
  };
}

test('it writes the rows and links that a scope consumer returns', async () => {
  await using store = await createTestStore({ plugins: [ledgerPlugin] });

  await store.apply(ledgerSource, [
    {
      type: 'ledger.account.opened',
      event: 'evt-1',
      entity: 'ledger:account:harbour',
      at: '2026-11-01T09:00:00.000Z',
      payload: { name: 'Harbour fund' },
    },
    {
      type: 'ledger.entry.posted',
      event: 'evt-2',
      entity: 'ledger:account:harbour',
      at: '2026-11-01T09:05:00.000Z',
      payload: { entry: 'e-1', amount: 40, rate: 1.5, memo: 'Rope', details: { till: 'north' } },
    },
  ]);

  const accounts = await store.readRows('ledger_account');
  const entries = await store.readRows('ledger_entry');
  const links = await store.readLinks();

  expect({ accounts, entries, links }).toStrictEqual({
    accounts: [
      {
        id: 'ledger:account:harbour',
        name: 'Harbour fund',
        balance: 40,
        is_closed: false,
        opened_at: '2026-11-01T09:00:00.000Z',
        updated_at: '2026-11-01T09:05:00.000Z',
      },
    ],
    entries: [
      {
        id: 'ledger:entry:e-1',
        account_id: 'ledger:account:harbour',
        amount: 40,
        rate: 1.5,
        memo: 'Rope',
        details: { till: 'north' },
        posted_at: '2026-11-01T09:05:00.000Z',
      },
    ],
    links: [
      {
        type: 'entry_of',
        from_id: 'ledger:entry:e-1',
        to_id: 'ledger:account:harbour',
        scope: 'ledger:account:harbour',
        origin: 'ledger_account',
        confidence: 1,
        evidence: 'event:ledger:evt-2',
      },
    ],
  });
});

test('it refuses a batch with a fact ID that the envelope parser refuses, and stores nothing', async () => {
  await using store = await createTestStore({ plugins: [ledgerPlugin] });

  const applied = store.apply(ledgerSource, [
    {
      type: 'ledger.account.opened',
      event: 'evt-1',
      entity: 'ledger:account:harbour',
      at: '2026-11-01T09:00:00.000Z',
      payload: { name: 'Harbour fund' },
    },
    {
      type: 'ledger.account.renamed',
      event: 'evt\n2',
      entity: 'ledger:account:harbour',
      at: '2026-11-01T09:01:00.000Z',
      payload: { name: 'Quay fund' },
    },
  ]);

  await expect(applied).rejects.toMatchObject({
    failure: { kind: 'refused-facts', reason: expect.stringContaining('not a fact ID') },
  });

  const accounts = await store.readRows('ledger_account');

  expect(accounts).toStrictEqual([]);
});

test('it refuses a link of a kind that the link type does not allow, as the host does', async () => {
  const ctx = await setupTest();

  const entry = await ctx.writeEntry(
    'wrong-kind',
    `export function applyScope(scope: string): string {
  return JSON.stringify([
    { link: { type: 'entry_of', from: 'ledger:entry:e-1', to: 'ledger:entry:e-2', confidence: 1, evidence: 'event:ledger:evt-1' } },
  ]);
}
`,
  );

  const plugin = definePlugin({
    name: 'ledger',
    sources: [ledgerSource],
    consumers: [{ ...ledgerAccountConsumer, entry }],
  });

  await using store = await createTestStore({ plugins: [plugin] });

  const applied = store.apply(ledgerSource, [
    {
      type: 'ledger.account.opened',
      event: 'evt-1',
      entity: 'ledger:account:harbour',
      at: '2026-11-01T09:00:00.000Z',
      payload: { name: 'Harbour fund' },
    },
  ]);

  await expect(applied).rejects.toMatchObject({
    failure: {
      kind: 'bad-link',
      problem: {
        kind: 'wrong-kind',
        end: 'to',
        id: 'ledger:entry:e-2',
        allowed: ['ledger:account'],
      },
    },
  });

  const links = await store.readLinks();

  expect(links).toStrictEqual([]);
});

test('it copies the sender into the payload of each fact as its origin', async () => {
  await using store = await createTestStore({ plugins: [notebookPlugin] });

  await store.apply(
    notebookSource,
    [
      {
        type: 'notebook.note.written',
        event: 'n-1',
        entity: 'notebook:note:shoals',
        at: '2026-11-01T09:00:00.000Z',
        payload: { text: 'Chart the shoals' },
      },
    ],
    { sender: { issuer: 'https://issuer.example', subject: 'worker-7' } },
  );

  const notes = await store.readRows('notebook_note');

  expect(notes).toStrictEqual([
    {
      id: 'notebook:note:shoals',
      text: 'Chart the shoals',
      count: 1,
      issuer: 'https://issuer.example',
    },
  ]);
});

test('it serves a fact-mode consumer the rows that earlier facts of the batch wrote', async () => {
  await using store = await createTestStore({ plugins: [notebookPlugin] });

  await store.apply(notebookSource, [
    {
      type: 'notebook.note.written',
      event: 'n-1',
      entity: 'notebook:note:shoals',
      at: '2026-11-01T09:00:00.000Z',
      payload: {
        text: 'Chart the shoals',
        origin: { issuer: 'https://issuer.example', subject: 'worker-7' },
      },
    },
    {
      type: 'notebook.note.written',
      event: 'n-2',
      entity: 'notebook:note:shoals',
      at: '2026-11-01T09:01:00.000Z',
      payload: {
        text: 'Chart the reef',
        origin: { issuer: 'https://issuer.example', subject: 'worker-7' },
      },
    },
  ]);

  const notes = await store.readRows('notebook_note');

  expect(notes).toStrictEqual([
    {
      id: 'notebook:note:shoals',
      text: 'Chart the reef',
      count: 2,
      issuer: 'https://issuer.example',
    },
  ]);
});

test('it skips a fact whose ID a fact-mode consumer applied before', async () => {
  await using store = await createTestStore({ plugins: [notebookPlugin] });

  const fact = {
    type: 'notebook.note.written',
    event: 'n-1',
    entity: 'notebook:note:shoals',
    at: '2026-11-01T09:00:00.000Z',
    payload: {
      text: 'Chart the shoals',
      origin: { issuer: 'https://issuer.example', subject: 'worker-7' },
    },
  } as const;

  await store.apply(notebookSource, [fact, fact]);
  await store.apply(notebookSource, [fact]);

  const notes = await store.readRows('notebook_note');

  expect(notes).toStrictEqual([
    {
      id: 'notebook:note:shoals',
      text: 'Chart the shoals',
      count: 1,
      issuer: 'https://issuer.example',
    },
  ]);
});

test('it answers a query from rows written for the test', async () => {
  await using store = await createTestStore({ plugins: [notebookPlugin] });

  await store.writeRows(notebookNoteConsumer, 'notebook_note', [
    {
      id: toTagged<EntityID>('notebook:note:reef'),
      text: 'Mark the reef',
      count: 4,
      issuer: 'https://issuer.example',
    },
  ]);

  const answer = await store.query(notebookCountQuery, { id: 'notebook:note:reef' });

  expect(answer).toStrictEqual({ count: 4 });
});

test('it names every consumer with no current version and runs no work', async () => {
  await using store = await createTestStore({ plugins: [notebookPlugin, ledgerPlugin] });

  store.reader.markDown('notebook_note');
  store.reader.markDown('ledger_account');

  const result = await store.reader.withConsumers(
    [notebookNoteConsumer, ledgerAccountConsumer],
    () => Promise.resolve('ran'),
  );

  expect(result).toStrictEqual({
    ok: false,
    failure: { reason: 'no-current-version', consumers: ['notebook_note', 'ledger_account'] },
  });
});

test('it shows the rows of every entity view and every link in the two shared views', async () => {
  await using store = await createTestStore({ plugins: [ledgerPlugin] });

  await store.apply(ledgerSource, [
    {
      type: 'ledger.account.opened',
      event: 'evt-1',
      entity: 'ledger:account:harbour',
      at: '2026-11-01T09:00:00.000Z',
      payload: { name: 'Harbour fund' },
    },
    {
      type: 'ledger.entry.posted',
      event: 'evt-2',
      entity: 'ledger:account:harbour',
      at: '2026-11-01T09:05:00.000Z',
      payload: { entry: 'e-1', amount: 40, rate: 1, memo: 'Rope', details: {} },
    },
  ]);

  const result = await store.reader.withConsumers([ledgerAccountConsumer], async (db) => {
    const entities = await db.selectFrom('entity').selectAll().orderBy('id').execute();
    const links = await db.selectFrom('link_effective').select(['type', 'origin']).execute();

    return { entities, links };
  });

  expect(result).toStrictEqual({
    ok: true,
    value: {
      entities: [
        {
          id: 'ledger:account:harbour',
          kind: 'ledger:account',
          title: 'Harbour fund',
          url: null,
          actor: null,
          updated_at: '2026-11-01T09:05:00.000Z',
        },
        {
          id: 'ledger:entry:e-1',
          kind: 'ledger:entry',
          title: 'Rope',
          url: null,
          actor: null,
          updated_at: '2026-11-01T09:05:00.000Z',
        },
      ],
      links: [{ type: 'entry_of', origin: 'ledger_account' }],
    },
  });
});

test('it keeps nothing that a query handler changes', async () => {
  await using store = await createTestStore({ plugins: [notebookPlugin] });

  await store.writeRows(notebookNoteConsumer, 'notebook_note', [
    {
      id: toTagged<EntityID>('notebook:note:reef'),
      text: 'Mark the reef',
      count: 4,
      issuer: 'https://issuer.example',
    },
  ]);

  await store.query(notebookPurgeQuery, {});

  const notes = await store.readRows('notebook_note');

  expect(notes).toStrictEqual([
    {
      id: 'notebook:note:reef',
      text: 'Mark the reef',
      count: 4,
      issuer: 'https://issuer.example',
    },
  ]);
});

test('it refuses a deployment that the kit check refuses', async () => {
  const twice = definePlugin({ name: 'ledger', consumers: [ledgerAccountConsumer] });

  await expect(createTestStore({ plugins: [ledgerPlugin, twice] })).rejects.toThrow(
    /the deployment is invalid/u,
  );
});
