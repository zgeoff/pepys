// oxlint-disable zgeoff/seed-only -- stands in for the Rust host, which writes the file the store reader reads
import { mkdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConsumerDeclaration, LinkRow } from '@pepys/kit';
import { generateSqliteSchema } from '@pepys/kit/generators';
import { connect } from '@tursodatabase/database';

interface ConsumerVersion {
  storeDirectory: string;
  consumer: ConsumerDeclaration;
  version: string;
  rows?: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
  links?: readonly LinkRow[];
  offsets?: readonly { stream: string; lastSeqNum: number }[];
  changeLog?: readonly { batch: number; changes: string }[];
}

// The tables the host makes in every consumer file beside the consumer's own, as `host-tables.json`
// records them. A test of the host checks that record.
const hostTables = `
CREATE TABLE offsets (stream TEXT NOT NULL PRIMARY KEY, last_seq_num INTEGER NOT NULL);
CREATE TABLE change_log (batch INTEGER NOT NULL PRIMARY KEY, changes TEXT NOT NULL);
CREATE TABLE applied_facts (fact_id TEXT NOT NULL PRIMARY KEY);
CREATE TABLE link (
  type TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL, scope TEXT,
  origin TEXT NOT NULL, confidence REAL NOT NULL, evidence TEXT NOT NULL,
  PRIMARY KEY (type, from_id, to_id)
);
CREATE INDEX link_to_id_idx ON link (to_id);
`;

// Writes `<store>/<consumer>/<version>/consumer.db` as the host would, and returns its folder.
export async function createConsumerVersion(options: ConsumerVersion): Promise<string> {
  const directory = join(options.storeDirectory, options.consumer.name, options.version);

  await mkdir(directory, { recursive: true });

  const database = await connect(join(directory, 'consumer.db'));

  try {
    await database.exec(generateSqliteSchema(options.consumer));
    await database.exec(hostTables);

    for (const [table, rows] of Object.entries(options.rows ?? {})) {
      for (const row of rows) {
        const columns = Object.keys(row);
        const placeholders = columns.map(() => '?').join(', ');

        await database.run(
          `insert into "${table}" (${columns.map((column) => `"${column}"`).join(', ')}) values (${placeholders})`,
          ...Object.values(row).map((value) => toStoredValue(value)),
        );
      }
    }

    for (const link of options.links ?? []) {
      await database.run(
        'insert into link (type, from_id, to_id, scope, origin, confidence, evidence) values (?, ?, ?, ?, ?, ?, ?)',
        link.type,
        link.from_id,
        link.to_id,
        link.scope,
        link.origin,
        link.confidence,
        link.evidence,
      );
    }

    for (const offset of options.offsets ?? []) {
      await database.run(
        'insert into offsets (stream, last_seq_num) values (?, ?)',
        offset.stream,
        offset.lastSeqNum,
      );
    }

    for (const entry of options.changeLog ?? []) {
      await database.run(
        'insert into change_log (batch, changes) values (?, ?)',
        entry.batch,
        entry.changes,
      );
    }
  } finally {
    await database.close();
  }

  return directory;
}

// Points `<store>/<consumer>/current` at a version, as `pepys up` does at a swap.
export async function writeCurrentVersion(
  storeDirectory: string,
  consumer: ConsumerDeclaration,
  version: string,
): Promise<void> {
  const link = join(storeDirectory, consumer.name, 'current');

  await rm(link, { force: true });
  await symlink(join(storeDirectory, consumer.name, version), link);
}

function toStoredValue(value: unknown): unknown {
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  return typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
}
