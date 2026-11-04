import type { LiveMode } from '@durable-streams/client';
import { createStateSchema } from '@durable-streams/state';
import { createStreamDB } from '@durable-streams/state/db';
import { z } from 'zod';
import type { ChangeFeedServer } from './create-change-feed-server.ts';
import type { ChangeLog } from './create-change-log.ts';

export interface StateCheckResult {
  readonly live: LiveMode;
  readonly changeLogRows: number;
  readonly tableRows: number;
  readonly preloadMs: number;
  readonly preloadMatches: boolean;
  readonly liveBatches: number;
  readonly liveMatches: boolean;
  readonly liveCatchUpMs: number | null;
}

const itemSchema = z.object({ id: z.string(), title: z.string(), number: z.number() });

const stateSchema = createStateSchema({
  items: { schema: itemSchema, type: 'item', primaryKey: 'id' },
});

const liveBatchCount = 5;

// The host's side, played by the spike: each batch writes the item table and its change log row in
// one transaction, then signals live readers.
export async function runStateCheck(
  changeLog: ChangeLog,
  server: ChangeFeedServer,
  live: LiveMode,
): Promise<StateCheckResult> {
  const path = `/v1/stream/consumer/items-${String(live)}`;
  const table = `item_${String(live).replace('-', '_')}`;

  await changeLog.db.schema
    .createTable(table)
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('title', 'text', (column) => column.notNull())
    .addColumn('number', 'integer', (column) => column.notNull())
    .execute();

  await changeLog.createStream({
    path,
    contentType: 'application/json',
    closed: false,
    ttlSeconds: null,
    expiresAt: null,
    initial: null,
    nowMs: Date.now(),
  });

  for (const change of buildSeedChanges()) {
    await writeBatch(changeLog, table, path, change);
  }

  const db = createStreamDB({
    streamOptions: { url: `${server.url}${path}`, contentType: 'application/json' },
    live,
    state: stateSchema,
  });

  const preloadStartMs = performance.now();

  await db.preload();

  const preloadMs = performance.now() - preloadStartMs;
  const readClientRows = () => toSortedRows(db.collections.items.toArray);

  const seededRows = await readTableRows(changeLog, table);

  const preloadMatches = Bun.deepEquals(readClientRows(), seededRows);
  const liveStartMs = performance.now();

  for (const change of buildLiveChanges()) {
    await writeBatch(changeLog, table, path, change);

    server.notifyCommit(path);
  }

  const expected = await readTableRows(changeLog, table);
  const liveMatches = await waitUntil(() => Bun.deepEquals(readClientRows(), expected));

  const liveCatchUpMs = liveMatches ? performance.now() - liveStartMs : null;

  db.close();

  const stream = await changeLog.readStream(path);

  return {
    live,
    changeLogRows: stream?.tail ?? 0,
    tableRows: expected.length,
    preloadMs: Math.round(preloadMs),
    preloadMatches,
    liveBatches: liveBatchCount,
    liveMatches,
    liveCatchUpMs: liveCatchUpMs === null ? null : Math.round(liveCatchUpMs),
  };
}

interface Item {
  readonly id: string;
  readonly title: string;
  readonly number: number;
}

type Change =
  | { readonly operation: 'insert'; readonly item: Item }
  | { readonly operation: 'update'; readonly item: Item; readonly old: Item }
  | { readonly operation: 'delete'; readonly old: Item };

const insertCount = 200;
const updateCount = 70;
const deleteCount = 30;

function buildSeedChanges(): Change[] {
  const inserts = Array.from({ length: insertCount }, (_, index) => ({
    operation: 'insert' as const,
    item: buildItem(index, 0),
  }));

  const updates = Array.from({ length: updateCount }, (_, index) => ({
    operation: 'update' as const,
    item: buildItem(index * 2, 1),
    old: buildItem(index * 2, 0),
  }));

  const deletes = Array.from({ length: deleteCount }, (_, index) => ({
    operation: 'delete' as const,
    old: buildItem(insertCount - 1 - index, 0),
  }));

  return [...inserts, ...updates, ...deletes];
}

function buildItem(index: number, revision: number): Item {
  return {
    id: `item-${index}`,
    title: `invented title ${index} rev ${revision}`,
    number: index * 10 + revision,
  };
}

const textEncoder = new TextEncoder();

async function writeBatch(changeLog: ChangeLog, table: string, path: string, change: Change) {
  const message = buildMessage(change);

  await changeLog.writeAppend(
    {
      path,
      data: textEncoder.encode(JSON.stringify([message])),
      close: false,
      seq: null,
      nowMs: Date.now(),
    },
    async (transaction) => {
      const rows = transaction.withTables<Record<string, Item>>();

      if (change.operation === 'insert') {
        await rows.insertInto(table).values(change.item).execute();
      } else if (change.operation === 'update') {
        await rows.updateTable(table).set(change.item).where('id', '=', change.item.id).execute();
      } else {
        await rows.deleteFrom(table).where('id', '=', change.old.id).execute();
      }
    },
  );
}

function buildMessage(change: Change) {
  if (change.operation === 'insert') {
    return {
      type: 'item',
      key: change.item.id,
      value: change.item,
      headers: { operation: 'insert' },
    };
  }

  if (change.operation === 'update') {
    return {
      type: 'item',
      key: change.item.id,
      value: change.item,
      old_value: change.old,
      headers: { operation: 'update' },
    };
  }

  return {
    type: 'item',
    key: change.old.id,
    old_value: change.old,
    headers: { operation: 'delete' },
  };
}

function toSortedRows(rows: readonly Item[]): Item[] {
  return rows
    .map((row) => ({ id: row.id, title: row.title, number: row.number }))
    .toSorted((left, right) => left.id.localeCompare(right.id));
}

async function readTableRows(changeLog: ChangeLog, table: string): Promise<Item[]> {
  const rows = await changeLog.db
    .withTables<Record<string, Item>>()
    .selectFrom(table)
    .select(['id', 'title', 'number'])
    .execute();

  return toSortedRows(rows);
}

function buildLiveChanges(): Change[] {
  return [
    { operation: 'insert', item: buildItem(insertCount, 0) },
    { operation: 'update', item: buildItem(1, 2), old: buildItem(1, 0) },
    { operation: 'delete', old: buildItem(3, 0) },
    { operation: 'update', item: buildItem(0, 2), old: buildItem(0, 1) },
    { operation: 'insert', item: buildItem(insertCount + 1, 0) },
  ];
}

const liveTimeoutMs = 5000;
const pollMs = 5;

async function waitUntil(isDone: () => boolean): Promise<boolean> {
  const deadline = performance.now() + liveTimeoutMs;

  while (performance.now() < deadline) {
    if (isDone()) {
      return true;
    }

    await Bun.sleep(pollMs);
  }

  return isDone();
}
