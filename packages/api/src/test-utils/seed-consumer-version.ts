import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { githubPullRequestSchemaPath } from '@pepys/source-github';
import { connect } from '@tursodatabase/database';

interface ConsumerVersionSeed {
  versionDirectory: string;
  row: Readonly<Record<string, string | number | null>>;
  offsets?: readonly { stream: string; lastSeqNum: number }[];
  changeLog?: readonly { batch: number; changes: string }[];
}

// the host writes these tables in crates/host/src/database.rs, and a seeded version mirrors them
const hostTables = `
CREATE TABLE offsets (stream TEXT NOT NULL PRIMARY KEY, last_seq_num INTEGER NOT NULL);
CREATE TABLE change_log (batch INTEGER NOT NULL PRIMARY KEY, changes TEXT NOT NULL);
`;

export async function seedConsumerVersion(options: ConsumerVersionSeed): Promise<void> {
  await mkdir(options.versionDirectory, { recursive: true });

  const schema = await Bun.file(githubPullRequestSchemaPath).text();
  const database = await connect(join(options.versionDirectory, 'consumer.db'));

  const columns = Object.keys(options.row);
  const placeholders = columns.map(() => '?').join(', ');

  await database.exec(schema);
  await database.exec(hostTables);

  // only the Rust host writes this row, from a consumer's operations, so no TypeScript module can
  await database.run(
    `insert into github_pull_request (${columns.join(', ')}) values (${placeholders})`,
    ...Object.values(options.row),
  );

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

  await database.close();
}
