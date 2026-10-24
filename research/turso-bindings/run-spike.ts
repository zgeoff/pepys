import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from '@tursodatabase/database';
import { connect } from '@tursodatabase/database';
import { $ } from 'bun';

const consumerCount = 30;

// SQLite's compile-time maximum for attached databases
const sqliteAttachLimit = 125;
const writerScript = join(import.meta.dir, 'write-row-from-second-process.ts');

const directory = await mkdtemp(join(tmpdir(), 'spike-turso-bindings-'));

try {
  const driver = await runDriverStep(directory);
  const attach = await runAttachStep(directory);
  const crossProcess = await runCrossProcessStep(directory);
  const fullText = await runFullTextStep(directory);
  const vector = await runVectorStep();
  const mvcc = await runMVCCStep(directory);

  console.log(JSON.stringify({ driver, attach, crossProcess, fullText, vector, mvcc }, null, 2));

  const failures = [
    ...(driver.passes ? [] : ['the binding lacks a call the Kysely driver needs']),
    ...(attach.attached === consumerCount && attach.writesRefused === consumerCount
      ? []
      : [`${attach.attached} files attached and ${attach.writesRefused} writes refused`]),
    ...(attach.entityViewErrors.length === 0 && attach.entityUnionRows === consumerCount
      ? []
      : [`a union over the attached entity views returned ${attach.entityUnionRows} rows`]),
    ...(crossProcess.direct.nextQuery === crossProcess.direct.before + 1
      ? []
      : ["a direct reader missed the second process's committed row"]),
  ];

  for (const failure of failures) {
    console.error(`FAIL: ${failure}`);
  }

  process.exitCode = failures.length === 0 ? 0 : 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function runDriverStep(root: string) {
  const db = await connect(join(root, 'driver.db'));

  await db.exec('create table item(id integer primary key, body text)');

  const insert = await db.prepare('insert into item(body) values (?)');
  const insertResult = await insert.run('first');
  const returning = await db.prepare('insert into item(body) values (?) returning id');
  const returningRows = await returning.all('second');
  const select = await db.prepare('select id, body from item where id > ? order by id');
  const allRows = await select.all(0);
  const firstRow: unknown = await select.get(0);

  const iteratedRows: unknown[] = [];

  for await (const row of select.iterate(0)) {
    iteratedRows.push(row);
  }

  const rawStatement = await db.prepare('select id, body from item order by id');
  const rawRows = await rawStatement.raw(true).all();

  // run() on a select reports the connection's last insert, not anything the select did
  const runOnSelect = await select.run(0);

  const transaction = db.transactionAsync(async (handle) => {
    await handle.run('insert into item(body) values (?)', 'in a transaction');
  });

  await transaction.immediate();

  const afterTransaction = await readCount(db, 'select count(*) as n from item');

  await db.exec('begin');
  await db.run('insert into item(body) values (?)', 'committed through exec');
  await db.exec('commit');

  const afterCommit = await readCount(db, 'select count(*) as n from item');

  await db.exec('begin');
  await db.run('insert into item(body) values (?)', 'rolled back');
  await db.exec('rollback');

  const afterRollback = await readCount(db, 'select count(*) as n from item');

  const readerFlags = { insert: insert.reader, returning: returning.reader, select: select.reader };
  const columns = select.columns();

  const safe = await db.prepare('select id from item order by id limit 1');
  const safeRow: unknown = await safe.safeIntegers(true).get();

  await db.close();

  return {
    passes:
      !readerFlags.insert &&
      readerFlags.returning &&
      readerFlags.select &&
      insertResult.changes === 1 &&
      insertResult.lastInsertRowid === 1 &&
      allRows.length === 2 &&
      iteratedRows.length === 2 &&
      afterTransaction === 3 &&
      afterCommit === 4 &&
      afterRollback === 4 &&
      !db.open,
    readerFlags,
    insertResult,
    returningRows,
    allRows,
    firstRow,
    iteratedRows,
    rawRows,
    runOnSelect,
    columns,
    afterTransaction,
    afterCommit,
    afterRollback,
    safeIntegerType: isRecord(safeRow) ? typeof safeRow['id'] : 'missing',
  };
}

async function runAttachStep(root: string) {
  const entityViewErrors: string[] = [];

  for (let index = 0; index < consumerCount; index += 1) {
    const consumer = await connect(join(root, `consumer-${index}.db`));

    await consumer.exec('create table item(id integer primary key, body text)');
    await consumer.run('insert into item(body) values (?)', `consumer ${index}`);

    const viewError = await readError(() =>
      consumer.exec('create view entity as select id, body from item'),
    );

    entityViewErrors.push(...(viewError === null ? [] : [viewError]));

    await consumer.close();
  }

  const refusedWithoutFlag = await probeRefused(async () => {
    const db = await connect(join(root, 'api-without-flag.db'));

    try {
      await db.exec(`attach '${join(root, 'consumer-0.db')}' as consumer_0`);
    } finally {
      await db.close();
    }
  });

  const db = await connect(join(root, 'api.db'), { experimental: ['attach', 'views'] });

  const started = performance.now();

  for (let index = 0; index < consumerCount; index += 1) {
    // a bare path attaches read-write; only the URI's mode=ro makes the file read-only
    await db.exec(
      `attach 'file:${join(root, `consumer-${index}.db`)}?mode=ro' as consumer_${index}`,
    );
  }

  const attachMs = Math.round(performance.now() - started);

  const databases = await db.all('pragma database_list');

  const attached = databases.length - 1;

  const union = Array.from(
    { length: consumerCount },
    (_, index) => `select ${index} as consumer, body from consumer_${index}.item`,
  ).join(' union all ');

  const unionResult = await db.all(union);

  const unionRows = unionResult.length;

  const viewError = await readError(() => db.exec(`create view every_item as ${union}`));

  const entityUnion = Array.from(
    { length: consumerCount },
    (_, index) => `select ${index} as consumer, id, body from consumer_${index}.entity`,
  ).join(' union all ');

  let entityUnionRows = 0;

  const entityUnionError = await readError(async () => {
    const rows = await db.all(entityUnion);

    entityUnionRows = rows.length;
  });

  let writesRefused = 0;

  for (let index = 0; index < consumerCount; index += 1) {
    const refused = await probeRefused(() =>
      db.run(`insert into consumer_${index}.item(body) values ('refused')`),
    );

    writesRefused += refused ? 1 : 0;
  }

  const writeError = await readError(() =>
    db.run("insert into consumer_0.item(body) values ('refused')"),
  );

  for (let index = consumerCount; index < sqliteAttachLimit + 1; index += 1) {
    await db.exec(
      `attach 'file:${join(root, `consumer-${index % consumerCount}.db`)}?mode=ro' as alias_${index}`,
    );
  }

  const aliasDatabases = await db.all('pragma database_list');

  await db.close();

  const bareDB = await connect(join(root, 'api-bare.db'), { experimental: ['attach'] });

  await bareDB.exec(`attach '${join(root, 'consumer-0.db')}' as consumer_0`);

  const bareWriteRefused = await probeRefused(() =>
    bareDB.run("insert into consumer_0.item(body) values ('accepted')"),
  );

  await bareDB.close();

  return {
    refusedWithoutFlag,
    entityViewErrors,
    entityUnionRows,
    entityUnionError,
    attached,
    attachMs,
    unionRows,
    viewError,
    writesRefused,
    writeError,
    bareWriteRefused,
    attachedPastSQLiteCeiling: aliasDatabases.length - 1,
  };
}

async function runCrossProcessStep(root: string) {
  const path = join(root, 'shared.db');

  const owner = await connect(path, { experimental: ['multiprocess_wal'] });

  await owner.exec('create table item(id integer primary key, body text)');
  await owner.close();

  const countItems = 'select count(*) as n from item';
  const countAttached = 'select count(*) as n from consumer.item';

  const direct = await connect(path, { readonly: true, experimental: ['multiprocess_wal'] });
  const directBefore = await readCount(direct, countItems);

  await runSecondWriter(path, 'multiprocess');

  const directNextQuery = await readCount(direct, countItems);

  await direct.close();

  const api = await connect(join(root, 'api-cross.db'), {
    experimental: ['attach', 'multiprocess_wal'],
  });

  await api.exec(`attach 'file:${path}?mode=ro' as consumer`);

  const attachedBefore = await readCount(api, countAttached);

  await runSecondWriter(path, 'multiprocess');

  const attachedNextQuery = await readCount(api, countAttached);

  await api.exec('detach consumer');
  await api.exec(`attach 'file:${path}?mode=ro' as consumer`);

  const attachedAfterReattach = await readCount(api, countAttached);

  await api.close();

  const sibling = await connect(path, { readonly: true, experimental: ['multiprocess_wal'] });

  const besideAPI = await connect(join(root, 'api-beside.db'), {
    experimental: ['attach', 'multiprocess_wal'],
  });

  await besideAPI.exec(`attach 'file:${path}?mode=ro' as consumer`);

  const besideDirectBefore = await readCount(besideAPI, countAttached);

  await runSecondWriter(path, 'multiprocess');

  const besideDirectNextQuery = await readCount(besideAPI, countAttached);

  await besideAPI.close();
  await sibling.close();

  const plainPath = join(root, 'plain.db');

  const plainOwner = await connect(plainPath);

  await plainOwner.exec('create table item(id integer primary key, body text)');

  const secondWriterError = await readError(() => runSecondWriter(plainPath, 'single-process'));
  const multiprocessWriterError = await readError(() => runSecondWriter(plainPath, 'multiprocess'));

  await plainOwner.close();

  const plainReader = await connect(plainPath, { readonly: true });

  await runSecondWriter(plainPath, 'single-process');

  const plainNextQuery = await readCount(plainReader, countItems);

  await plainReader.close();

  const plainReopened = await connect(plainPath, { readonly: true });
  const plainAfterReopen = await readCount(plainReopened, countItems);

  await plainReopened.close();

  return {
    direct: { before: directBefore, nextQuery: directNextQuery },
    attached: {
      before: attachedBefore,
      nextQuery: attachedNextQuery,
      afterReattach: attachedAfterReattach,
    },
    attachedBesideDirect: { before: besideDirectBefore, nextQuery: besideDirectNextQuery },
    singleProcess: {
      secondWriterError,
      multiprocessWriterError,
      readerNextQuery: plainNextQuery,
      readerAfterReopen: plainAfterReopen,
    },
  };
}

async function runSecondWriter(path: string, walMode: 'multiprocess' | 'single-process') {
  await $`${process.execPath} ${writerScript} ${path} ${walMode}`.quiet();
}

async function runFullTextStep(root: string) {
  const path = join(root, 'full-text.db');

  const refusedWithoutFlag = await readError(async () => {
    const db = await connect(':memory:');

    try {
      await db.exec('create table doc(body text); create index doc_fts on doc using fts (body)');
    } finally {
      await db.close();
    }
  });

  const db = await connect(path, { experimental: ['index_method'] });

  await db.exec('create table doc(id integer primary key, body text)');
  await db.exec('create index doc_fts on doc using fts (body)');

  await db.batch([
    { sql: 'insert into doc(body) values (?)', args: ['fix the login bug in PEP-42'] },
    { sql: 'insert into doc(body) values (?)', args: ['deploy commit 9f3a2c to staging'] },
    { sql: 'insert into doc(body) values (?)', args: ['lunch with the team'] },
    { sql: 'insert into doc(body) values (?)', args: ['another login problem'] },
  ]);

  const ranked = await db.all(
    'select id, fts_score(body, ?1) as score from doc where fts_match(body, ?1) order by score desc',
    'login',
  );

  // two separate placeholders, as Kysely's SQLite compiler writes them
  const rankedTwoPlaceholders = await db.all(
    'select id, fts_score(body, ?) as score from doc where fts_match(body, ?) order by score desc',
    'login',
    'login',
  );

  const identifier = await db.all('select id from doc where fts_match(body, ?)', 'PEP-42');
  const commit = await db.all('select id from doc where fts_match(body, ?)', '9f3a2c');
  const matchOperator = await db.all('select id from doc where body match ?', 'login');

  const highlight = await db.all(
    "select fts_highlight(body, ?, '[', ']') as text from doc where id = 1",
    'login',
  );

  await db.close();

  const api = await connect(join(root, 'api-full-text.db'), { experimental: ['attach'] });

  await api.exec(`attach 'file:${path}?mode=ro' as consumer`);

  const throughAttach = await api.all(
    'select id from consumer.doc where fts_match(body, ?)',
    'login',
  );

  await api.close();

  return {
    refusedWithoutFlag,
    ranked,
    rankedTwoPlaceholders,
    identifier,
    commit,
    matchOperator,
    highlight,
    throughAttach,
    sqliteCLI: await runSQLiteCLI(path),
  };
}

async function runVectorStep() {
  const db = await connect(':memory:', { experimental: ['index_method'] });

  await db.exec('create table embedding(id integer primary key, vector blob)');

  await db.exec(
    "insert into embedding(vector) values (vector32('[1,0,0]')), (vector32('[0,1,0]')), (vector32('[0.9,0.1,0]'))",
  );

  const nearest = await db.all(
    'select id, vector_distance_cos(vector, vector32(?)) as distance from embedding order by distance limit 2',
    '[1,0,0]',
  );

  const blobRow: unknown = await db.get('select vector from embedding where id = 1');

  const denseIndexError = await readError(() =>
    db.exec('create index embedding_index on embedding (libsql_vector_idx(vector))'),
  );

  const topKError = await readError(() =>
    db.all("select * from vector_top_k('embedding_index', vector32('[1,0,0]'), 2)"),
  );

  const denseIVFError = await readError(() =>
    db.exec('create index embedding_ivf on embedding using toy_vector_sparse_ivf (vector)'),
  );

  await db.exec('create table sparse(id integer primary key, vector blob)');

  await db.exec(
    "insert into sparse(vector) values (vector32_sparse('[1,0,0,0]')), (vector32_sparse('[0,1,0,0]')), (vector32_sparse('[0.9,0,0.1,0]'))",
  );

  await db.exec('create index sparse_ivf on sparse using toy_vector_sparse_ivf (vector)');

  const sparseNearest = await db.all(
    'select id, vector_distance_jaccard(vector, vector32_sparse(?)) as distance from sparse order by distance limit 2',
    '[1,0,0,0]',
  );

  await db.close();

  return {
    nearest,
    blobType:
      isRecord(blobRow) && blobRow['vector'] instanceof Uint8Array
        ? `${blobRow['vector'].constructor.name} of ${blobRow['vector'].byteLength} bytes`
        : 'missing',
    denseIndexError,
    topKError,
    denseIVFError,
    sparseNearest,
  };
}

async function runMVCCStep(root: string) {
  const path = join(root, 'mvcc.db');

  const db = await connect(path);

  await db.exec('create table item(id integer primary key, body text)');
  await db.run('insert into item(body) values (?)', 'before mvcc');

  const walHeader = await readVersionBytes(path);
  const walCLI = await runSQLiteCLI(path);
  const switched = await db.all("pragma journal_mode = 'mvcc'");

  await db.run('insert into item(body) values (?)', 'under mvcc');
  await db.close();

  const mvccHeader = await readVersionBytes(path);
  const mvccCLI = await runSQLiteCLI(path);
  const reopened = await connect(path);
  const reopenedRows = await readCount(reopened, 'select count(*) as n from item');
  const reopenedMode = await reopened.all('pragma journal_mode');
  const api = await connect(join(root, 'api-mvcc.db'), { experimental: ['attach'] });
  const attachError = await readError(() => api.exec(`attach 'file:${path}?mode=ro' as consumer`));

  await api.close();
  await reopened.all("pragma journal_mode = 'wal'");
  await reopened.close();

  return {
    walHeader,
    walCLI,
    switched,
    mvccHeader,
    mvccCLI,
    reopenedRows,
    reopenedMode,
    attachError,
    revertedCLI: await runSQLiteCLI(path),
  };
}

async function readCount(db: Database, sql: string) {
  const row: unknown = await db.get(sql);

  if (!isRecord(row) || typeof row['n'] !== 'number') {
    throw new Error(`expected a numeric n from ${sql}`);
  }

  return row['n'];
}

async function readVersionBytes(path: string) {
  const header = await Bun.file(path).slice(0, 20).bytes();

  return { write: header[18], read: header[19] };
}

async function runSQLiteCLI(path: string) {
  if (Bun.which('sqlite3') === null) {
    return 'sqlite3 missing';
  }

  const result = await $`sqlite3 ${path} "select count(*) from sqlite_schema"`.nothrow().quiet();

  return result.exitCode === 0 ? 'opens' : result.stderr.toString().trim();
}

async function probeRefused(action: () => Promise<unknown>) {
  return (await readError(action)) !== null;
}

async function readError(action: () => Promise<unknown>) {
  try {
    await action();

    return null;
  } catch (error) {
    const message =
      error instanceof $.ShellError
        ? (error.stderr
            .toString()
            .split('\n')
            .find((line) => line.includes('rror:')) ?? `exit ${error.exitCode}`)
        : String(error);

    return message.trim().replaceAll(directory, '<dir>');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
