import { createTursoDialect } from '@pepys/kysely-turso';
import { connect } from '@tursodatabase/database';
import { Kysely, sql } from 'kysely';
import type { Transaction } from 'kysely';

// One stream row per change feed, and one change_log row per batch. A batch number is the stream
// offset, as the change feed design sets.
export interface ChangeLogSchema {
  stream: {
    path: string;
    stream_id: number;
    content_type: string;
    closed: number;
    tail: number;
    last_seq: string | null;
    ttl_seconds: number | null;
    expires_at: string | null;
    touched_ms: number;
  };
  change_log: {
    stream_id: number;
    batch: number;
    data: Uint8Array;
  };
}

export interface StreamRow {
  readonly path: string;
  readonly streamID: number;
  readonly contentType: string;
  readonly closed: boolean;
  readonly tail: number;
  readonly lastSeq: string | null;
  readonly ttlSeconds: number | null;
  readonly expiresAt: string | null;
  readonly touchedMs: number;
}

export interface Batch {
  readonly batch: number;
  readonly data: Uint8Array;
}

export interface NewStream {
  readonly path: string;
  readonly contentType: string;
  readonly closed: boolean;
  readonly ttlSeconds: number | null;
  readonly expiresAt: string | null;
  readonly initial: Uint8Array | null;
  readonly nowMs: number;
}

export interface Append {
  readonly path: string;
  readonly data: Uint8Array | null;
  readonly close: boolean;
  readonly seq: string | null;
  readonly nowMs: number;
}

export interface ChangeLog {
  readonly db: Kysely<ChangeLogSchema>;
  readStream: (path: string) => Promise<StreamRow | null>;
  readBatches: (streamID: number, after: number, maxBytes: number) => Promise<Batch[]>;
  createStream: (stream: NewStream) => Promise<StreamRow>;

  // writeRows runs in the append's transaction, as the host writes a batch's rows with its change.
  writeAppend: (
    append: Append,
    writeRows?: (transaction: Transaction<ChangeLogSchema>) => Promise<void>,
  ) => Promise<StreamRow>;
  writeTouch: (path: string, nowMs: number) => Promise<void>;
  removeStream: (path: string) => Promise<void>;
  close: () => Promise<void>;
}

export async function createChangeLog(path: string): Promise<ChangeLog> {
  const db = new Kysely<ChangeLogSchema>({
    dialect: createTursoDialect({ database: () => connect(path) }),
  });

  await sql`create table if not exists stream (
    path text primary key,
    stream_id integer not null unique,
    content_type text not null,
    closed integer not null,
    tail integer not null,
    last_seq text,
    ttl_seconds integer,
    expires_at text,
    touched_ms integer not null
  )`.execute(db);

  await sql`create table if not exists change_log (
    stream_id integer not null,
    batch integer not null,
    data blob not null,
    primary key (stream_id, batch)
  )`.execute(db);

  const readStream = async (streamPath: string): Promise<StreamRow | null> => {
    const row = await db
      .selectFrom('stream')
      .selectAll()
      .where('path', '=', streamPath)
      .executeTakeFirst();

    return row === undefined ? null : toStreamRow(row);
  };

  return {
    db,
    readStream,
    readBatches: async (streamID, after, maxBytes) => {
      const rows = await db
        .selectFrom('change_log')
        .select(['batch', 'data'])
        .where('stream_id', '=', streamID)
        .where('batch', '>', after)
        .orderBy('batch')
        .execute();

      return pickChunk(rows, maxBytes);
    },
    createStream: async (stream) => {
      await db.transaction().execute(async (transaction) => {
        const last = await transaction
          .selectFrom('stream')
          .select((eb) => eb.fn.max('stream_id').as('streamID'))
          .executeTakeFirstOrThrow();

        const streamID = (last.streamID ?? 0) + 1;
        const tail = stream.initial === null ? 0 : 1;

        await transaction
          .insertInto('stream')
          .values({
            path: stream.path,
            stream_id: streamID,
            content_type: stream.contentType,
            closed: stream.closed ? 1 : 0,
            tail,
            last_seq: null,
            ttl_seconds: stream.ttlSeconds,
            expires_at: stream.expiresAt,
            touched_ms: stream.nowMs,
          })
          .execute();

        if (stream.initial !== null) {
          await transaction
            .insertInto('change_log')
            .values({ stream_id: streamID, batch: 1, data: stream.initial })
            .execute();
        }
      });

      const created = await readStream(stream.path);

      if (created === null) {
        throw new Error(`the stream ${stream.path} vanished after its create`);
      }

      return created;
    },
    writeAppend: async (append, writeRows) => {
      await db.transaction().execute(async (transaction) => {
        await writeRows?.(transaction);

        const current = await transaction
          .selectFrom('stream')
          .select(['stream_id', 'tail'])
          .where('path', '=', append.path)
          .executeTakeFirstOrThrow();

        const tail = append.data === null ? current.tail : current.tail + 1;

        if (append.data !== null) {
          await transaction
            .insertInto('change_log')
            .values({ stream_id: current.stream_id, batch: tail, data: append.data })
            .execute();
        }

        await transaction
          .updateTable('stream')
          .set((eb) => ({
            tail,
            closed: append.close ? 1 : eb.ref('closed'),
            last_seq: append.seq ?? eb.ref('last_seq'),
            touched_ms: append.nowMs,
          }))
          .where('path', '=', append.path)
          .execute();
      });

      const updated = await readStream(append.path);

      if (updated === null) {
        throw new Error(`the stream ${append.path} vanished after an append`);
      }

      return updated;
    },
    writeTouch: async (streamPath, nowMs) => {
      await db
        .updateTable('stream')
        .set({ touched_ms: nowMs })
        .where('path', '=', streamPath)
        .execute();
    },
    removeStream: async (streamPath) => {
      await db.transaction().execute(async (transaction) => {
        const current = await transaction
          .selectFrom('stream')
          .select('stream_id')
          .where('path', '=', streamPath)
          .executeTakeFirst();

        if (current === undefined) {
          return;
        }

        await transaction
          .deleteFrom('change_log')
          .where('stream_id', '=', current.stream_id)
          .execute();

        await transaction.deleteFrom('stream').where('path', '=', streamPath).execute();
      });
    },
    close: () => db.destroy(),
  };
}

function toStreamRow(row: ChangeLogSchema['stream']): StreamRow {
  return {
    path: row.path,
    streamID: row.stream_id,
    contentType: row.content_type,
    closed: row.closed === 1,
    tail: row.tail,
    lastSeq: row.last_seq,
    ttlSeconds: row.ttl_seconds,
    expiresAt: row.expires_at,
    touchedMs: row.touched_ms,
  };
}

// A response holds whole batches up to maxBytes, and always at least one batch.
function pickChunk(rows: readonly Batch[], maxBytes: number): Batch[] {
  const chunk: Batch[] = [];
  let bytes = 0;

  for (const row of rows) {
    if (chunk.length > 0 && bytes + row.data.length > maxBytes) {
      break;
    }

    chunk.push({ batch: row.batch, data: new Uint8Array(row.data) });

    bytes += row.data.length;
  }

  return chunk;
}
