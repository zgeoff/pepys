import { expect, onTestFinished, spyOn, test } from 'bun:test';
import { createIngest, createMemoryFactLog, noSenderProof } from '@pepys/ingest';
import { checkDeployment, toStreamName, toStreamOffset } from '@pepys/kit';
import type { EntityID, FactID } from '@pepys/kit';
import { createFactBatchSender } from '@pepys/kit/send';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { ledgerPlugin, ledgerSource } from '../ledger/ledger-plugin.ts';
import { createTestStore } from '../test-store/create-test-store.ts';
import { notebookPlugin, notebookSource } from '../test-utils/notebook/notebook-plugin.ts';
import { applyFactLog } from './apply-fact-log.ts';

async function setupTest() {
  const plugins = [notebookPlugin, ledgerPlugin];
  const checked = checkDeployment({ name: 'harbour', plugins });

  invariant(checked.ok, 'the two plug-ins make a valid deployment');

  const deployment = checked.value;
  const noteStream = toStreamName('facts.notebook.note');
  const log = createMemoryFactLog([noteStream, toStreamName('facts.ledger.account')]);

  const ingest = createIngest({
    deployment,
    secrets: { NOTEBOOK_TOKEN: 'quay-token', LEDGER_SECRET: 'quay-secret' },
    log,
    senderProof: noSenderProof,
    appendRetry: { maxAttempts: 1, retryDelayMs: 0 },
    now: () => Date.now(),
  });

  const store = await createTestStore({ plugins });

  onTestFinished(() => store[Symbol.asyncDispose]());

  return {
    deployment,
    log,
    noteStream,
    store,
    createStore: async () => {
      const other = await createTestStore({ plugins });

      onTestFinished(() => other[Symbol.asyncDispose]());

      return other;
    },
    sendNotes: createFactBatchSender({
      source: notebookSource,
      url: 'http://ingest.test/notebook/facts',
      secret: 'quay-token',
      fetch: ingest.handleRequest,
    }),
    sendLedger: createFactBatchSender({
      source: ledgerSource,
      url: 'http://ingest.test/ledger/facts',
      secret: 'quay-secret',
      fetch: ingest.handleRequest,
    }),
  };
}

test('it writes the row of a fact that ingest stored for a fact consumer', async () => {
  const ctx = await setupTest();

  await ctx.sendNotes([
    {
      type: 'notebook.note.written',
      event: 'evt-1',
      entity: 'notebook:note:shoals',
      at: '2026-11-02T07:00:00Z',
      payload: { text: 'Low water at six', origin: { issuer: 'https://id.example', subject: 'w' } },
    },
  ]);

  await applyFactLog(ctx.store, ctx.log, ctx.deployment);

  const notes = await ctx.store.readRows('notebook_note');

  expect(notes).toStrictEqual([
    {
      id: 'notebook:note:shoals',
      text: 'Low water at six',
      count: 1,
      issuer: 'https://id.example',
    },
  ]);
});

test('it writes the rows of the facts that ingest stored for a scope consumer', async () => {
  const ctx = await setupTest();

  await ctx.sendLedger([
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
      at: '2026-11-01T09:05:00.000Z',
      payload: { name: 'Harbour trust' },
    },
  ]);

  await applyFactLog(ctx.store, ctx.log, ctx.deployment);

  const accounts = await ctx.store.readRows('ledger_account');

  expect(accounts).toStrictEqual([
    {
      id: 'ledger:account:harbour',
      name: 'Harbour trust',
      balance: 0,
      is_closed: false,
      opened_at: '2026-11-01T09:00:00.000Z',
      updated_at: '2026-11-01T09:05:00.000Z',
    },
  ]);
});

test('it writes nothing for a log with no records', async () => {
  const ctx = await setupTest();

  await applyFactLog(ctx.store, ctx.log, ctx.deployment);

  const notes = await ctx.store.readRows('notebook_note');

  expect(notes).toStrictEqual([]);
});

test('it applies a record that the log stored after the last call', async () => {
  const ctx = await setupTest();

  const origin = { issuer: 'https://id.example', subject: 'w' };

  await ctx.sendNotes([
    {
      type: 'notebook.note.written',
      event: 'evt-1',
      entity: 'notebook:note:shoals',
      at: '2026-11-02T07:00:00Z',
      payload: { text: 'Low water at six', origin },
    },
  ]);

  await applyFactLog(ctx.store, ctx.log, ctx.deployment);

  await ctx.sendNotes([
    {
      type: 'notebook.note.written',
      event: 'evt-2',
      entity: 'notebook:note:shoals',
      at: '2026-11-02T08:00:00Z',
      payload: { text: 'Flood tide', origin },
    },
  ]);

  await applyFactLog(ctx.store, ctx.log, ctx.deployment);

  const notes = await ctx.store.readRows('notebook_note');

  expect(notes).toStrictEqual([
    { id: 'notebook:note:shoals', text: 'Flood tide', count: 2, issuer: 'https://id.example' },
  ]);
});

test('it reads a stream from the offset where the last call stopped', async () => {
  const ctx = await setupTest();

  const origin = { issuer: 'https://id.example', subject: 'w' };

  await ctx.sendNotes([
    {
      type: 'notebook.note.written',
      event: 'evt-1',
      entity: 'notebook:note:shoals',
      at: '2026-11-02T07:00:00Z',
      payload: { text: 'Low water at six', origin },
    },
  ]);

  await applyFactLog(ctx.store, ctx.log, ctx.deployment);

  await ctx.sendNotes([
    {
      type: 'notebook.note.written',
      event: 'evt-2',
      entity: 'notebook:note:shoals',
      at: '2026-11-02T08:00:00Z',
      payload: { text: 'Flood tide', origin },
    },
  ]);

  const read = spyOn(ctx.log, 'read');

  await applyFactLog(ctx.store, ctx.log, ctx.deployment);

  expect(read.mock.calls.filter(([stream]) => stream === ctx.noteStream)).toStrictEqual([
    [ctx.noteStream, toStreamOffset(1), 1],
  ]);
});

test('it applies the whole log to a second store', async () => {
  const ctx = await setupTest();

  await ctx.sendNotes([
    {
      type: 'notebook.note.written',
      event: 'evt-1',
      entity: 'notebook:note:shoals',
      at: '2026-11-02T07:00:00Z',
      payload: { text: 'Low water at six', origin: { issuer: 'https://id.example', subject: 'w' } },
    },
  ]);

  await applyFactLog(ctx.store, ctx.log, ctx.deployment);

  const other = await ctx.createStore();

  await applyFactLog(other, ctx.log, ctx.deployment);

  const notes = await other.readRows('notebook_note');

  expect(notes).toStrictEqual([
    {
      id: 'notebook:note:shoals',
      text: 'Low water at six',
      count: 1,
      issuer: 'https://id.example',
    },
  ]);
});

test('it refuses the same record again after a call that a consumer refused', async () => {
  const ctx = await setupTest();

  await ctx.log.appendBatch(
    ctx.noteStream,
    [
      {
        id: toTagged<FactID>('event:notebook:evt-9'),
        type: 'notebook.note.written',
        v: 1,
        api: 'notebook/1',
        entity: toTagged<EntityID>('notebook:note:shoals'),
        at: '2026-11-02T07:00:00Z',
        payload: { text: 'A note with no origin' },
      },
    ],
    toStreamOffset(0),
  );

  await applyFactLog(ctx.store, ctx.log, ctx.deployment).catch(() => null);

  const second = applyFactLog(ctx.store, ctx.log, ctx.deployment);

  expect(second).rejects.toMatchObject({ failure: { kind: 'entry', consumer: 'notebook_note' } });
});

test('it throws for a log that lacks a stream a consumer reads', async () => {
  const ctx = await setupTest();

  const log = createMemoryFactLog([ctx.noteStream]);
  const applied = applyFactLog(ctx.store, log, ctx.deployment);

  expect(applied).rejects.toThrowWithMessage(Error, /facts\.ledger\.account/u);
});

test('it throws for a store that createTestStore did not make', async () => {
  const ctx = await setupTest();

  const applied = applyFactLog({ ...ctx.store }, ctx.log, ctx.deployment);

  expect(applied).rejects.toThrowWithMessage(Error, /createTestStore/u);
});
