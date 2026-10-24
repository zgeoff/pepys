import { setTimeout } from 'node:timers/promises';
import { AppendInput, AppendRecord, S2, S2Error } from '@s2-dev/streamstore';
import type { S2Basin, S2Stream, StreamConfig } from '@s2-dev/streamstore';
import { $ } from 'bun';
import { buildDurabilityResult } from './build-durability-result.ts';
import type {
  Acknowledgement,
  DurabilityLog,
  DurabilityResult,
  FailedAppend,
  Kill,
  StoredRecord,
} from './build-durability-result.ts';
import { buildLatencySummary } from './build-latency-summary.ts';
import type { LatencySummary } from './build-latency-summary.ts';
import { runAppendOutcome } from './run-append-outcome.ts';
import type { AppendOutcome } from './run-append-outcome.ts';

const spikeDir = import.meta.dir;
const projectName = `pepys-spike-s2-lite-${crypto.randomUUID().slice(0, 8)}`;
const projectLabel = `label=com.docker.compose.project=${projectName}`;
const s2LitePort = readFreePort();
const s2LiteURL = `http://127.0.0.1:${s2LitePort}`;
const composeEnvironment = { ...process.env, S2_LITE_PORT: String(s2LitePort) };

// Invented local fixtures, matching compose.yaml.
const garageKeyID = 'GK000000000000000000000000';
const garageSecretKey = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const garageBucket = 'facts';
const basinName = 'pepys-spike';
const infiniteBasinName = 'pepys-spike-infinite';
const durabilityStreamName = 'facts.spike.durability';
const conditionsStreamName = 'facts.spike.conditions';
const fencingToken = 'writer-a';
const killCount = 5;
const appendersInFlight = 8;
const settleMs = 4000;
const downtimeMs = 500;
const failureBackoffMs = 100;
const healthTimeoutMs = 60_000;
const tailSampleCount = 50;
const readPageCount = 1000;
const infiniteRetention: StreamConfig = { retentionPolicy: { infinite: {} } };
const signalExitCodes = { SIGINT: 130, SIGTERM: 143 } as const;

const stopController = new AbortController();

const received: { signal?: keyof typeof signalExitCodes } = {};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    received.signal ??= signal;

    console.error(`${signal} received, stopping the spike`);
    stopController.abort();
  });
}

const exitCode = await runSpikeInContainers(stopController.signal);

const finalExitCode = received.signal === undefined ? exitCode : signalExitCodes[received.signal];

process.exit(finalExitCode);

async function runSpikeInContainers(stop: AbortSignal): Promise<number> {
  const foreignResources = await readProjectResources();

  if (foreignResources !== '') {
    console.error(`Docker already holds resources for ${projectName}, so the spike refuses them`);

    return 1;
  }

  // Every resource under this project name from here on is this run's, since none existed before.
  try {
    await runStartup(stop);

    const result = await runSpike(stop);

    console.log(JSON.stringify(result, null, 2));

    const failures = collectFailures(result);

    for (const failure of failures) {
      console.error(`FAIL: ${failure}`);
    }

    const verdict = failures.length === 0 ? 'PASS' : 'FAIL';

    console.log(verdict);

    return failures.length === 0 ? 0 : 1;
  } catch (error: unknown) {
    const reason = stop.aborted ? 'a signal' : error;

    console.error('The spike stopped before its checks ran:', reason);

    return 1;
  } finally {
    await runCompose(['down', '--volumes', '--remove-orphans']);

    console.error(`removed compose project ${projectName}`);
  }
}

async function readProjectResources(): Promise<string> {
  const containers = await $`docker ps --all --quiet --filter ${projectLabel}`.quiet();
  const volumes = await $`docker volume ls --quiet --filter ${projectLabel}`.quiet();
  const networks = await $`docker network ls --quiet --filter ${projectLabel}`.quiet();

  return [containers, volumes, networks]
    .map((output) => output.stdout.toString())
    .join('')
    .trim();
}

async function runStartup(stop: AbortSignal): Promise<void> {
  stop.throwIfAborted();

  await runCompose(['up', '--detach', 'garage']);
  await createGarageBucket(stop);

  stop.throwIfAborted();

  await runCompose(['up', '--detach', 's2-lite']);
  await waitForHealth(stop);
}

function readFreePort(): number {
  const listener = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: { data: () => {} },
  });

  const port = listener.port;

  listener.stop(true);

  return port;
}

async function runCompose(args: readonly string[]): Promise<string> {
  const output = await $`docker compose --project-name ${projectName} --profile s2-lite ${args}`
    .cwd(spikeDir)
    .env(composeEnvironment)
    .quiet();

  return output.stdout.toString();
}

function runGarage(args: readonly string[]): Promise<string> {
  return runCompose(['exec', '-T', 'garage', '/garage', ...args]);
}

async function createGarageBucket(stop: AbortSignal): Promise<void> {
  const nodeID = await waitForGarageNodeID(stop);

  await runGarage(['layout', 'assign', '-z', 'dc1', '-c', '1G', nodeID]);
  await runGarage(['layout', 'apply', '--version', '1']);
  await runGarage(['bucket', 'create', garageBucket]);
  await runGarage(['key', 'import', '--yes', '-n', 's2-lite', garageKeyID, garageSecretKey]);

  await runGarage([
    'bucket',
    'allow',
    '--read',
    '--write',
    '--owner',
    garageBucket,
    '--key',
    's2-lite',
  ]);
}

async function waitForGarageNodeID(stop: AbortSignal): Promise<string> {
  const deadline = Date.now() + healthTimeoutMs;

  while (Date.now() < deadline) {
    stop.throwIfAborted();

    const output = await runGarage(['node', 'id', '-q']).catch(() => '');

    const [nodeID] = output.trim().split('@');

    if (nodeID !== undefined && nodeID !== '') {
      return nodeID;
    }

    await Bun.sleep(250);
  }

  throw new Error('Garage did not report a node ID before the deadline');
}

async function waitForHealth(stop: AbortSignal): Promise<void> {
  const deadline = Date.now() + healthTimeoutMs;

  while (Date.now() < deadline) {
    stop.throwIfAborted();

    const isHealthy = await probeHealth();

    if (isHealthy) {
      return;
    }

    await Bun.sleep(50);
  }

  throw new Error('s2-lite did not report healthy before the deadline');
}

async function probeHealth(): Promise<boolean> {
  const response = await fetch(`${s2LiteURL}/health`).catch(() => null);

  return response?.ok ?? false;
}

interface SpikeResult {
  readonly retention: RetentionResult;
  readonly conditions: ConditionsResult;
  readonly durability: DurabilityResult;
  readonly tail: TailResult;
}

async function runSpike(stop: AbortSignal): Promise<SpikeResult> {
  const basin = await createBasin();
  const retentionBeforeKills = await readRetention(createClient());
  const conditionsBeforeKills = await runConditionChecks(basin.stream(conditionsStreamName));
  const durability = await runDurabilityLoop(basin.stream(durabilityStreamName), stop);

  const clientAfterKills = createClient();
  const basinAfterKills = clientAfterKills.basin(basinName);

  const retentionAfterKills = await readRetention(clientAfterKills);

  const conditionsAfterKills = await runFenceChecksAfterKills(
    basinAfterKills.stream(conditionsStreamName),
  );

  const tail = await readTail(basinAfterKills.stream(durabilityStreamName));
  const readBack = await readWholeStream(basinAfterKills.stream(durabilityStreamName), tail.seqNum);

  return {
    retention: { beforeKills: retentionBeforeKills, afterKills: retentionAfterKills },
    conditions: { beforeKills: conditionsBeforeKills, afterKills: conditionsAfterKills },
    durability: buildDurabilityResult(durability, readBack, settleMs),
    tail: { seqNum: tail.seqNum, readCount: readBack.length, latency: tail.latency },
  };
}

function createClient(): S2 {
  return new S2({
    accessToken: 'ignored',
    endpoints: { account: s2LiteURL, basin: s2LiteURL },
    requestTimeoutMillis: 5000,

    // One attempt per append: a retried append whose outcome was unknown could write a record twice.
    retry: { maxAttempts: 1 },
  });
}

async function createBasin(): Promise<S2Basin> {
  const client = createClient();

  await client.basins.create({ basin: basinName });

  await client.basins.create({
    basin: infiniteBasinName,
    config: { createStreamOnAppend: true, defaultStreamConfig: infiniteRetention },
  });

  const autoCreated = AppendRecord.string({ body: 'created on append' });

  await client
    .basin(infiniteBasinName)
    .stream('spike.created-on-append')
    .append(AppendInput.create([autoCreated]));

  const basin = client.basin(basinName);

  await basin.streams.create({ stream: durabilityStreamName, config: infiniteRetention });
  await basin.streams.create({ stream: conditionsStreamName, config: infiniteRetention });
  await basin.streams.create({ stream: 'spike.default-retention' });

  await basin.streams.create({
    stream: 'spike.reconfigured-retention',
    config: { retentionPolicy: { ageSecs: 3600 } },
  });

  await basin.streams.reconfigure({
    stream: 'spike.reconfigured-retention',
    retentionPolicy: { infinite: {} },
  });

  return basin;
}

interface RetentionResult {
  readonly beforeKills: RetentionSnapshot;
  readonly afterKills: RetentionSnapshot;
}

interface RetentionSnapshot {
  readonly createdInfinite: StreamConfig['retentionPolicy'];
  readonly reconfiguredToInfinite: StreamConfig['retentionPolicy'];
  readonly basinDefault: StreamConfig['retentionPolicy'];
  readonly inheritedFromBasin: StreamConfig['retentionPolicy'];
}

async function readRetention(client: S2): Promise<RetentionSnapshot> {
  const basin = client.basin(basinName);

  const created = await basin.streams.getConfig({ stream: durabilityStreamName });
  const reconfigured = await basin.streams.getConfig({ stream: 'spike.reconfigured-retention' });
  const basinDefault = await basin.streams.getConfig({ stream: 'spike.default-retention' });

  const inherited = await client
    .basin(infiniteBasinName)
    .streams.getConfig({ stream: 'spike.created-on-append' });

  return {
    createdInfinite: created.retentionPolicy,
    reconfiguredToInfinite: reconfigured.retentionPolicy,
    basinDefault: basinDefault.retentionPolicy,
    inheritedFromBasin: inherited.retentionPolicy,
  };
}

interface ConditionsResult {
  readonly beforeKills: ConditionOutcomes;
  readonly afterKills: FenceOutcomesAfterKills;
}

interface ConditionOutcomes {
  readonly tailSeqNum: number;
  readonly matchingSeqNum: AppendOutcome;
  readonly staleSeqNum: AppendOutcome;
  readonly fenceRecord: AppendOutcome;
  readonly matchingFencingToken: AppendOutcome;
  readonly wrongFencingToken: AppendOutcome;
  readonly noFencingToken: AppendOutcome;
}

async function runConditionChecks(stream: S2Stream): Promise<ConditionOutcomes> {
  await stream.append(AppendInput.create([AppendRecord.string({ body: 'first' })]));

  const tailResponse = await stream.checkTail();

  const tailSeqNum = tailResponse.tail.seqNum;

  return {
    tailSeqNum,
    matchingSeqNum: await runAppendOutcome(stream, { matchSeqNum: tailSeqNum }),
    staleSeqNum: await runAppendOutcome(stream, { matchSeqNum: tailSeqNum }),
    fenceRecord: await runAppendOutcome(stream, {}, AppendRecord.fence(fencingToken)),
    matchingFencingToken: await runAppendOutcome(stream, { fencingToken }),
    wrongFencingToken: await runAppendOutcome(stream, { fencingToken: 'writer-b' }),
    noFencingToken: await runAppendOutcome(stream, {}),
  };
}

interface FenceOutcomesAfterKills {
  readonly matchingFencingToken: AppendOutcome;
  readonly wrongFencingToken: AppendOutcome;
}

async function runFenceChecksAfterKills(stream: S2Stream): Promise<FenceOutcomesAfterKills> {
  return {
    matchingFencingToken: await runAppendOutcome(stream, { fencingToken }),
    wrongFencingToken: await runAppendOutcome(stream, { fencingToken: 'writer-b' }),
  };
}

async function runDurabilityLoop(stream: S2Stream, stop: AbortSignal): Promise<DurabilityLog> {
  const acknowledgements: Acknowledgement[] = [];
  const failures: FailedAppend[] = [];
  const kills: Kill[] = [];
  const state = { nextRecordNumber: 0, isStopped: false };

  const runAppender = async (): Promise<void> => {
    while (!state.isStopped && !stop.aborted) {
      const recordNumber = state.nextRecordNumber;

      state.nextRecordNumber += 1;

      const startedAtMs = performance.now();
      const record = AppendRecord.string({ body: String(recordNumber) });

      try {
        const ack = await stream.append(AppendInput.create([record]));

        acknowledgements.push({
          recordNumber,
          seqNum: ack.start.seqNum,
          latencyMs: performance.now() - startedAtMs,
        });
      } catch (error: unknown) {
        failures.push({ recordNumber, startedAtMs, reason: formatFailure(error) });

        await Bun.sleep(failureBackoffMs);
      }
    }
  };

  const appenders = Array.from({ length: appendersInFlight }, runAppender);

  try {
    const containerOutput = await runCompose(['ps', '--quiet', 's2-lite']);

    const containerID = containerOutput.trim();

    for (let killIndex = 0; killIndex < killCount; killIndex += 1) {
      // Bun.sleep takes no abort signal, and a signal must end the wait at once.
      await setTimeout(settleMs, undefined, { signal: stop });

      const atAttempt = state.nextRecordNumber;
      const startedAtMs = performance.now();

      await $`docker kill --signal SIGKILL ${containerID}`.quiet();

      const endedAtMs = performance.now();

      console.log(`kill ${killIndex + 1} at attempt ${atAttempt}`);

      await setTimeout(downtimeMs, undefined, { signal: stop });

      const restartedAtMs = performance.now();

      await $`docker start ${containerID}`.quiet();

      await waitForHealth(stop);

      kills.push({
        atAttempt,
        startedAtMs,
        endedAtMs,
        recoveryMs: performance.now() - restartedAtMs,
      });
    }

    await setTimeout(settleMs, undefined, { signal: stop });
  } finally {
    state.isStopped = true;

    await Promise.all(appenders);
  }

  return { acknowledgements, failures, kills };
}

function formatFailure(error: unknown): string {
  if (error instanceof S2Error) {
    return `${error.status} ${error.code ?? error.message}`;
  }

  return error instanceof Error ? error.message : String(error);
}

interface Tail {
  readonly seqNum: number;
  readonly latency: LatencySummary;
}

async function readTail(stream: S2Stream): Promise<Tail> {
  const latencies: number[] = [];
  let seqNum = 0;

  for (let sample = 0; sample < tailSampleCount; sample += 1) {
    const startedAt = performance.now();

    const tailResponse = await stream.checkTail();

    latencies.push(performance.now() - startedAt);

    seqNum = tailResponse.tail.seqNum;
  }

  return { seqNum, latency: buildLatencySummary(latencies) };
}

async function readWholeStream(stream: S2Stream, tailSeqNum: number): Promise<StoredRecord[]> {
  const records: StoredRecord[] = [];

  while (records.length < tailSeqNum) {
    const batch = await stream.read({
      start: { from: { seqNum: records.length } },
      stop: { limits: { count: readPageCount } },
    });

    if (batch.records.length === 0) {
      return records;
    }

    for (const record of batch.records) {
      records.push({ seqNum: record.seqNum, body: record.body });
    }
  }

  return records;
}

interface TailResult {
  readonly seqNum: number;
  readonly readCount: number;
  readonly latency: LatencySummary;
}

function collectFailures(result: SpikeResult): string[] {
  const durability = result.durability;
  const retention = result.retention;
  const tail = result.tail;

  const checks: readonly (readonly [boolean, string])[] = [
    [durability.kills.length >= 3, `only ${durability.kills.length} kills ran`],
    [durability.acknowledged > 0, 'no append was acknowledged'],
    [durability.gaps === 0, `${durability.gaps} sequence numbers out of place`],
    [durability.acknowledgedMissing === 0, `${durability.acknowledgedMissing} acknowledged lost`],
    [durability.acknowledgedMisplaced === 0, `${durability.acknowledgedMisplaced} misplaced`],
    [durability.duplicates === 0, `${durability.duplicates} bodies stored twice`],
    [durability.unknownBodies === 0, `${durability.unknownBodies} bodies never appended`],
    [tail.readCount === tail.seqNum, `read ${tail.readCount} records, tail at ${tail.seqNum}`],
    [isInfinite(retention.afterKills.createdInfinite), 'infinite retention did not survive'],
    [isInfinite(retention.afterKills.reconfiguredToInfinite), 'reconfigured retention lost'],
    [isInfinite(retention.afterKills.inheritedFromBasin), 'basin default retention lost'],
    ...buildConditionChecks(result.conditions),
  ];

  return checks.filter(([isPassing]) => !isPassing).map(([, message]) => message);
}

function isInfinite(policy: StreamConfig['retentionPolicy']): boolean {
  return policy !== null && policy !== undefined && 'infinite' in policy;
}

function buildConditionChecks(conditions: ConditionsResult): (readonly [boolean, string])[] {
  const before = conditions.beforeKills;
  const after = conditions.afterKills;
  const tailSeqNum = before.tailSeqNum;

  const tokenMismatch: AppendOutcome = {
    kind: 'fencingTokenMismatch',
    expectedFencingToken: fencingToken,
  };

  const expectations: readonly (readonly [string, AppendOutcome, AppendOutcome])[] = [
    ['matching matchSeqNum', before.matchingSeqNum, { kind: 'acknowledged', seqNum: tailSeqNum }],
    [
      'stale matchSeqNum',
      before.staleSeqNum,
      { kind: 'seqNumMismatch', expectedSeqNum: tailSeqNum + 1 },
    ],
    ['fence record', before.fenceRecord, { kind: 'acknowledged', seqNum: tailSeqNum + 1 }],
    [
      'matching fencingToken',
      before.matchingFencingToken,
      { kind: 'acknowledged', seqNum: tailSeqNum + 2 },
    ],
    ['wrong fencingToken', before.wrongFencingToken, tokenMismatch],
    ['no fencingToken', before.noFencingToken, { kind: 'acknowledged', seqNum: tailSeqNum + 3 }],
    [
      'matching fencingToken after the kills',
      after.matchingFencingToken,
      { kind: 'acknowledged', seqNum: tailSeqNum + 4 },
    ],
    ['wrong fencingToken after the kills', after.wrongFencingToken, tokenMismatch],
  ];

  return expectations.map(([name, actual, expected]) => [
    Bun.deepEquals(actual, expected),
    `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  ]);
}
