import { start } from '@zgeoff/testing/process';

interface LiveWriter {
  // the writer's process ID, which also names the process group it leads
  pid: number;

  // runs one statement and resolves once it is committed
  run: (statement: string) => Promise<void>;
}

const writerSource = `
import { connect } from '@tursodatabase/database';

const writer = await connect(process.argv[1], { experimental: ['multiprocess_wal'] });

console.log('ready');

for await (const line of console) {
  if (line === '') {
    break;
  }

  await writer.exec(JSON.parse(line));
  console.log('done');
}

await writer.close();
`;

// A second process that holds a consumer file open with Turso's multi-process WAL for its whole
// life, as the host does, and runs each statement it is sent. Turso shares one database per path
// within a process, so only another process shows what a reader sees of the host.
export async function startLiveWriter(
  path: string,
  stack: AsyncDisposableStack,
): Promise<LiveWriter> {
  const writer = await start([process.execPath, '--eval', writerSource, path], {
    cwd: import.meta.dir,
    ready: { stdout: 'ready' },
  });

  stack.use(writer);

  return {
    pid: writer.pid,
    run: async (statement) => {
      await writer.write(`${JSON.stringify(statement)}\n`);
      await writer.waitForLine('done');
    },
  };
}
