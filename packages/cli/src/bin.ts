#!/usr/bin/env bun
import { once } from 'node:events';
import { runCLI } from './run-cli.ts';

// Exit at once: a startup request that `pepys start` stopped waiting for, such as one to an S2
// endpoint that never answers, would otherwise keep the event loop, and the process, alive.
const exitCode = await runCLI(process.argv.slice(2));

// Bun's `process.exit` drops what a pipe has not taken yet, past the first 128 KiB, and its
// `writableNeedDrain` stays false, so end each stream and wait until it has written everything.
await Promise.all([endStream(process.stdout), endStream(process.stderr)]);

process.exit(exitCode);

async function endStream(stream: NodeJS.WriteStream): Promise<void> {
  const finished = once(stream, 'finish');

  stream.end();

  await finished;
}
