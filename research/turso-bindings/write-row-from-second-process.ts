import { connect } from '@tursodatabase/database';

const [path, walMode] = process.argv.slice(2);

if (path === undefined || (walMode !== 'multiprocess' && walMode !== 'single-process')) {
  console.error(
    'usage: bun write-row-from-second-process.ts <database_path> multiprocess|single-process',
  );

  process.exit(1);
}

const db = await connect(path, {
  experimental: walMode === 'multiprocess' ? ['multiprocess_wal'] : [],
});

await db.run('insert into item(body) values (?)', 'from the second process');
await db.close();
