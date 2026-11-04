import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';
import { buildConformanceSummary } from './build-conformance-summary.ts';
import { createChangeFeedServer } from './create-change-feed-server.ts';
import { createChangeLog } from './create-change-log.ts';
import { runStateCheck } from './run-state-check.ts';

const spikeDir = import.meta.dir;
const longPollTimeoutMs = 2000;
const sseConnectionMs = 60_000;
const maxChunkBytes = 4096;

const workDir = await mkdtemp(join(tmpdir(), 'pepys-spike-durable-streams-'));
const exitCode = await runSpikeInWorkDir(workDir);

process.exit(exitCode);

async function runSpikeInWorkDir(directory: string): Promise<number> {
  try {
    return await runSpike(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function runSpike(directory: string): Promise<number> {
  const changeLog = await createChangeLog(join(directory, 'feed.db'));

  const server = createChangeFeedServer({
    changeLog,
    port: 0,
    longPollTimeoutMs,
    sseConnectionMs,
    maxChunkBytes,
  });

  try {
    const reportPath = join(directory, 'vitest.json');
    const startMs = performance.now();

    const vitest =
      await $`node ${join(spikeDir, 'node_modules/vitest/vitest.mjs')} run --config ${join(spikeDir, 'vitest.config.ts')} --reporter=json --outputFile=${reportPath}`
        .env({
          ...process.env,
          CONFORMANCE_TEST_URL: server.url,
          CONFORMANCE_LONG_POLL_TIMEOUT_MS: String(longPollTimeoutMs),
        })
        .quiet()
        .nothrow();

    const conformanceMs = Math.round(performance.now() - startMs);

    const reportText = await readFile(reportPath, 'utf8');

    const conformance = buildConformanceSummary(reportText);

    const sse = await runStateCheck(changeLog, server, 'sse');
    const longPoll = await runStateCheck(changeLog, server, 'long-poll');
    const nodeVersion = await $`node --version`.text();

    const versions = { bun: Bun.version, node: nodeVersion.trim() };

    console.log(
      JSON.stringify(
        {
          versions,
          vitestExitCode: vitest.exitCode,
          conformanceMs,
          conformance,
          stateChecks: [sse, longPoll],
        },
        null,
        2,
      ),
    );

    const passed =
      conformance.totals.read.failed === 0 &&
      [sse, longPoll].every(
        (check) => check.preloadMatches && check.isReaderWaiting && check.liveMatches,
      );

    return passed ? 0 : 1;
  } finally {
    await server.stop();
    await changeLog.close();
  }
}
