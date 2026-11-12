interface LiveWriter {
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
  const child = Bun.spawn([process.execPath, '--eval', writerSource, path], {
    cwd: import.meta.dir,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'inherit',
  });

  // before the wait for the first answer, so a writer that never answers stops too
  stack.defer(async () => {
    child.kill();

    await child.exited;
  });

  const lines = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = '';

  const readLine = async (): Promise<string> => {
    while (!buffered.includes('\n')) {
      const chunk = await lines.read();

      if (chunk.done) {
        throw new Error('the live writer ended before it answered');
      }

      buffered += chunk.value;
    }

    const end = buffered.indexOf('\n');
    const line = buffered.slice(0, end);

    buffered = buffered.slice(end + 1);

    return line;
  };

  await readLine();

  return {
    run: async (statement) => {
      await child.stdin.write(`${JSON.stringify(statement)}\n`);
      await child.stdin.flush();

      await readLine();
    },
  };
}
