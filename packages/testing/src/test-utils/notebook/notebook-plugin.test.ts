import { expect, onTestFinished, test } from 'bun:test';
import { NoResultError } from 'kysely';
import { createTestStore } from '../../test-store/create-test-store.ts';
import { notebookCountQuery, notebookPlugin, notebookSource } from './notebook-plugin.ts';

async function setupTest() {
  const store = await createTestStore({ plugins: [notebookPlugin] });

  onTestFinished(() => store[Symbol.asyncDispose]());

  return { store };
}

test("it counts the facts of a note through its own row, with the newest text and the sender's issuer", async () => {
  const ctx = await setupTest();

  await ctx.store.apply(
    notebookSource,
    [
      {
        type: 'notebook.note.written',
        event: 'n-11',
        entity: 'notebook:note:quay',
        at: '2026-11-05T10:00:00.000Z',
        payload: { text: 'Sweep the quay' },
      },
      {
        type: 'notebook.note.written',
        event: 'n-12',
        entity: 'notebook:note:quay',
        at: '2026-11-05T10:05:00.000Z',
        payload: { text: 'Sweep the quay twice' },
      },
    ],
    { sender: { issuer: 'https://tide.example', subject: 'keeper' } },
  );

  const notes = await ctx.store.readRows('notebook_note');

  expect(notes).toStrictEqual([
    {
      id: 'notebook:note:quay',
      text: 'Sweep the quay twice',
      count: 2,
      issuer: 'https://tide.example',
    },
  ]);
});

test('#notebookCountQuery answers the count of one note', async () => {
  const ctx = await setupTest();

  await ctx.store.apply(
    notebookSource,
    [
      {
        type: 'notebook.note.written',
        event: 'n-21',
        entity: 'notebook:note:lamp',
        at: '2026-11-05T11:00:00.000Z',
        payload: { text: 'Trim the lamp' },
      },
    ],
    { sender: { issuer: 'https://tide.example', subject: 'keeper' } },
  );

  const answer = await ctx.store.query(notebookCountQuery, { id: 'notebook:note:lamp' });

  expect(answer).toStrictEqual({ count: 1 });
});

test('#notebookCountQuery throws for a note with no row', async () => {
  const ctx = await setupTest();

  const answering = ctx.store.query(notebookCountQuery, { id: 'notebook:note:absent' });

  expect(answering).rejects.toThrowWithMessage(NoResultError, 'no result');
});
