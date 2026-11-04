import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { githubPullRequestSchemaPath } from '@pepys/source-github';
import { connect } from '@tursodatabase/database';

interface StubConsumerVersion {
  versionDirectory: string;
  row: Readonly<Record<string, string | number | null>>;
}

export async function createStubConsumerVersion(options: StubConsumerVersion): Promise<void> {
  await mkdir(options.versionDirectory, { recursive: true });

  const schema = await Bun.file(githubPullRequestSchemaPath).text();
  const database = await connect(join(options.versionDirectory, 'consumer.db'));

  const columns = Object.keys(options.row);
  const placeholders = columns.map(() => '?').join(', ');

  await database.exec(schema);

  await database.run(
    `insert into github_pull_request (${columns.join(', ')}) values (${placeholders})`,
    ...Object.values(options.row),
  );

  await database.close();
}
