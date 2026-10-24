import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { connect } from '@tursodatabase/database';

const schemaPath = join(
  import.meta.dir,
  '../../source-github/src/generated/github-pull-request.sql',
);

interface StubConsumerVersion {
  versionDirectory: string;
  row: Readonly<Record<string, string | number | null>>;
}

export async function createStubConsumerVersion(options: StubConsumerVersion): Promise<void> {
  await mkdir(options.versionDirectory, { recursive: true });

  const schema = await Bun.file(schemaPath).text();
  const database = await connect(join(options.versionDirectory, 'consumer.db'));

  const columns = Object.keys(options.row);
  const placeholders = columns.map(() => '?').join(', ');

  await database.exec(schema);

  const insert = await database.prepare(
    `insert into github_pull_request (${columns.join(', ')}) values (${placeholders})`,
  );

  await insert.run(...Object.values(options.row));
  await database.close();
}
