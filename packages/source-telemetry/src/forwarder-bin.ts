#!/usr/bin/env bun
import { once } from 'node:events';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { createLogger } from '@pepys/kit';
import { runInstall } from './forwarder/install/run-install.ts';
import { runForwarder } from './forwarder/run-forwarder.ts';

const usage =
  'usage: pepys-telemetry-forwarder run | install --issuer <name> --audience <audience> [--ingest-url <url>]\n';

const exitCode = await runCommand(process.argv.slice(2));

await Promise.all([endStream(process.stdout), endStream(process.stderr)]);

process.exit(exitCode);

async function runCommand(args: readonly string[]): Promise<number> {
  const [command, ...rest] = args;

  if (command === 'run' && rest.length === 0) {
    const stop = new AbortController();

    process.once('SIGINT', () => stop.abort());
    process.once('SIGTERM', () => stop.abort());

    try {
      return await runForwarder({
        environment: process.env,
        logger: createLogger(process.stderr),
        signal: stop.signal,
      });
    } catch (error) {
      process.stderr.write(
        `the forwarder stopped: ${error instanceof Error ? error.message : 'unknown'}\n`,
      );

      return 1;
    }
  }

  if (command === 'install') {
    return runInstall({
      argv: rest,
      environment: process.env,
      home: homedir(),
      binPath: realpathSync(import.meta.path),
      bunPath: process.execPath,
      stdout: process.stdout,
      stderr: process.stderr,
    });
  }

  process.stderr.write(usage);

  return 1;
}

async function endStream(stream: NodeJS.WriteStream): Promise<void> {
  const finished = once(stream, 'finish');

  stream.end();

  await finished;
}
