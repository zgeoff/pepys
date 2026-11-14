import { join } from 'node:path';
import { githubPullRequestConsumer } from '@pepys/source-github';
import { WringerError, createWringer, local } from '@wringer/core';
import type { Wringer } from '@wringer/core';
import { db } from '@wringer/db';
import { http } from '@wringer/http';
import { stream } from '@wringer/stream';
import { z } from 'zod';
import { writeGithubDelivery } from '../../packages/cli/src/test-utils/write-github-delivery.ts';
import { buildWebhookDeliveries } from './build-webhook-deliveries.ts';
import { createAPIClient } from './create-api-client.ts';
import { createControlClient } from './create-control-client.ts';
import { checkAnswers } from './doctor/check-answers.ts';
import { checkAPI } from './doctor/check-api.ts';
import { checkContainers } from './doctor/check-containers.ts';
import { checkHost } from './doctor/check-host.ts';
import { featurePaths, ignoredPaths, sharedPaths } from './feature-paths.ts';
import { parseRunEndpoints } from './parse-run-endpoints.ts';
import { readConsumerProgress } from './read-consumer-progress.ts';
import { readStreamReads } from './read-stream-reads.ts';
import { waitForCaughtUp } from './wait-for-caught-up.ts';
import { writeTelemetryExport } from './write-telemetry-export.ts';
import { writeVoyage } from './write-voyage.ts';

const noInput = z.strictObject({});
const timeSchema = z.iso.datetime();

const entityIDText = z
  .string()
  .regex(/^[a-z]+:[a-z_]+:.+$/u, 'Write an entity ID as <source>:<kind>:<id>.');

const progressSchema = z.strictObject({
  consumer: z.string(),
  stream: z.string(),
  appliedThrough: z.number().int().nullable(),
  tail: z.number().int(),
});

const modelRequestSchema = z.strictObject({
  id: z.string().min(1),
  model: z.string().min(1),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cacheReadTokens: z.number().int().min(0).default(0),
  cacheCreationTokens: z.number().int().min(0).default(0),
  costUsd: z.number().min(0).optional(),
  at: timeSchema,
});

const sentSchema = z.strictObject({ sent: z.number().int(), deliveries: z.array(z.string()) });

const caughtUpSchema = z.strictObject({
  consumers: z.array(z.string()),
  waitedMs: z.number().int(),
});

const hostReadSchema = z.strictObject({
  at: z.string(),
  seqNum: z.number().int(),
  count: z.number().int(),
});

const hostReadsSchema = z.strictObject({ reads: z.array(hostReadSchema) });
const pullRequestStream = 'facts.github.pull_request';
const launcherPath = join(import.meta.dir, 'local', 'run-local-stack.ts');
const storeSqlitePath = join(import.meta.dir, 'local', 'run-store-sqlite.ts');

// The host stops and starts within seconds; the first start compiles each consumer module.
const hostCheckTimeoutMs = 110_000;

// The registry's name is not `pepys`: gunshi reads a command group named like the program as the
// program itself.
export function createVerifyRegistry(): Wringer {
  return createWringer({ name: 'pepys-verify' })
    .use(http({}))
    .use(db({}))
    .use(stream({}))
    .target('local', {
      mode: 'launch',
      access: 'read-write',
      host: local(),
      launch: (ctx) => ({
        command: [process.execPath, launcherPath, ctx.runDirectory],
        ready: (line) => (line['event'] === 'ready' ? parseRunEndpoints(line) : null),
      }),
      drivers: {
        // Every call goes to the API's oRPC routes, which POST each call and only read, so a read
        // command and a doctor check may send them.
        http: () => ({
          endpoint: 'api',
          healthPath: '/rpc',
          readOnly: { allow: [{ method: 'POST', path: '/rpc/*' }] },
        }),

        // sqlite3 cannot read the host's files, so the db driver runs a stand-in on a copy
        db: (ctx) => ({
          via: 'exec',
          dialect: 'sqlite',
          database: join(parseRunEndpoints(ctx.endpoints).store, githubPullRequestConsumer.name),
          program: [process.execPath, storeSqlitePath],
        }),

        // s2-lite logs each read with its start, `seq_num`, which shows where the host resumed
        stream: (ctx) => {
          const run = parseRunEndpoints(ctx.endpoints);

          return {
            sources: {
              host: { file: run.hostLog },
              s2: { command: ['docker', 'logs', '--follow', `${run.project}-s2-lite-1`] },
            },
          };
        },
      },
    })
    .action({
      name: 'send-webhook',
      summary:
        'Send a signed GitHub delivery to ingest: a pull request opened (--count opens that many from --number up), reviewed or merged, or a release published',
      effect: 'write',
      input: z.strictObject({
        event: z.enum(['opened', 'reviewed', 'merged', 'released']),
        number: z.number().int().min(1).max(9999).optional(),
        title: z.string().min(1).optional(),
        tag: z
          .string()
          .regex(/^v\d+\.\d+\.\d+$/u, 'Write a tag as v<major>.<minor>.<patch>.')
          .optional(),
        at: timeSchema,
        count: z.number().int().min(1).max(200).default(1),
      }),
      data: sentSchema,
      run: async (input, ctx) => {
        const built = buildWebhookDeliveries(input);

        if (!built.ok) {
          throw new WringerError('usage', { message: built.message });
        }

        const run = parseRunEndpoints(ctx.endpoints);

        const webhookURL = new URL('/webhook/github', run.ingest).href;

        for (const delivery of built.deliveries) {
          await writeGithubDelivery(webhookURL, delivery);
        }

        return {
          sent: built.deliveries.length,
          deliveries: built.deliveries.map((delivery) => delivery.deliveryID),
        };
      },
    })
    .action({
      name: 'send-telemetry',
      summary:
        "Send one OTLP logs export that holds a Claude Code model request per entry of --requests in --session, proven by the run's identity issuer",
      effect: 'write',
      input: z.strictObject({
        session: z.string().min(1),
        requests: z.array(modelRequestSchema).min(1).max(20),
      }),
      data: z.strictObject({ session: z.string(), issuer: z.string(), subject: z.string() }),
      run: (input, ctx) => writeTelemetryExport(parseRunEndpoints(ctx.endpoints), input),
    })
    .action({
      name: 'send-voyage',
      summary:
        'Send a signed logbook fact batch: one voyage that cites the pull request with the number --cites',
      effect: 'write',
      input: z.strictObject({
        voyage: z.string().regex(/^[a-z0-9-]+$/u, 'Name a voyage in lowercase, such as v-31.'),
        title: z.string().min(1),
        cites: z.number().int().min(1).max(9999),
        at: timeSchema,
      }),
      data: z.strictObject({ voyage: z.string() }),
      run: (input, ctx) => writeVoyage(parseRunEndpoints(ctx.endpoints).ingest, input),
    })
    .action({
      name: 'stop-host',
      summary:
        "Stop the host with SIGTERM, leaving ingest and the API running, and report the pull request consumer's saved offset",
      effect: 'write',
      input: noInput,
      data: z.strictObject({
        host: z.enum(['running', 'stopped']),
        exitCode: z.number().int().nullable(),
        progress: progressSchema,
      }),
      run: async (_input, ctx) => {
        const run = parseRunEndpoints(ctx.endpoints);

        const stopped = await createControlClient(run.control).stopHost();

        const progress = await readConsumerProgress(
          run,
          githubPullRequestConsumer,
          pullRequestStream,
        );

        return { ...stopped, progress };
      },
    })
    .action({
      name: 'start-host',
      summary:
        "Start the host again with `run --up`, and report the pull request consumer's saved offset it resumes after",
      effect: 'write',
      input: noInput,
      data: z.strictObject({
        host: z.enum(['running', 'stopped']),
        starts: z.number().int(),
        progress: progressSchema,
      }),
      run: async (_input, ctx) => {
        const run = parseRunEndpoints(ctx.endpoints);

        const progress = await readConsumerProgress(
          run,
          githubPullRequestConsumer,
          pullRequestStream,
        );

        const started = await createControlClient(run.control).startHost();

        return { ...started, progress };
      },
    })
    .command({
      path: ['caught-up'],
      summary:
        'Wait until each consumer a journey reads has applied every fact on its stream, up to --wait-ms',
      effect: 'read',
      args: z.strictObject({ waitMs: z.number().int().min(1000).max(110_000).default(30_000) }),
      data: caughtUpSchema,
      timeoutMs: 120_000,
      run: (args, ctx) => waitForCaughtUp(parseRunEndpoints(ctx.endpoints), args.waitMs),
    })
    .command({
      path: ['host-reads'],
      summary:
        "List the host's reads of one fact stream since `use`, each with the offset it starts at, from s2-lite's log",
      effect: 'read',
      args: z.strictObject({
        stream: z.string().regex(/^facts\.[a-z_.]+$/u, 'Name a fact stream.'),
      }),
      data: hostReadsSchema,
      run: (args, ctx) => readStreamReads(ctx.drivers.stream, args.stream),
    })
    .command({
      path: ['query', 'delivery'],
      summary:
        'Call github_pull_request_delivery for one pull request and one environment, through the API',
      effect: 'read',
      args: z.strictObject({ pullRequest: entityIDText, environment: z.string().min(1) }),
      data: z.array(z.unknown()),
      run: (args, ctx) => {
        const api = createAPIClient(ctx.drivers.http);

        return api.github_pull_request_delivery({
          pullRequests: [args.pullRequest],
          environment: args.environment,
        });
      },
    })
    .command({
      path: ['query', 'session-requests'],
      summary:
        'Call telemetry_session_model_requests for one session and the sender that proved it, through the API',
      effect: 'read',
      args: z.strictObject({
        session: entityIDText,
        issuer: z.string().min(1),
        subject: z.string().min(1),
      }),
      data: z.array(z.unknown()),
      run: (args, ctx) => createAPIClient(ctx.drivers.http).telemetry_session_model_requests(args),
    })
    .command({
      path: ['query', 'entity'],
      summary: 'Call get_entity for an entity ID or an alias, through the API',
      effect: 'read',
      args: z.strictObject({ id: z.string().min(1) }),
      data: z.unknown(),
      run: (args, ctx) => createAPIClient(ctx.drivers.http).get_entity({ id: args.id }),
    })
    .command({
      path: ['query', 'neighbourhood'],
      summary: 'Call neighbourhood from an entity ID, one link deep, through the API',
      effect: 'read',
      args: z.strictObject({ id: entityIDText }),
      data: z.unknown(),
      run: (args, ctx) => createAPIClient(ctx.drivers.http).neighbourhood({ id: args.id }),
    })
    .check({
      name: 'docker',
      input: noInput,
      data: z.strictObject({ project: z.string() }),
      timeoutMs: 10_000,
      run: (_input, ctx) => checkContainers(parseRunEndpoints(ctx.endpoints)),
    })
    .check({
      name: 's2-lite',
      input: noInput,
      data: z.strictObject({ url: z.string() }),
      timeoutMs: 5000,
      run: (_input, ctx) => checkAnswers(parseRunEndpoints(ctx.endpoints), 's2-lite'),
    })
    .check({
      name: 'garage',
      input: noInput,
      data: z.strictObject({ url: z.string() }),
      timeoutMs: 5000,
      run: (_input, ctx) => checkAnswers(parseRunEndpoints(ctx.endpoints), 'garage'),
    })
    .check({
      name: 'ingest',
      input: noInput,
      data: z.strictObject({ url: z.string() }),
      timeoutMs: 5000,
      run: (_input, ctx) => checkAnswers(parseRunEndpoints(ctx.endpoints), 'ingest'),
    })
    .check({
      name: 'api',
      input: noInput,
      data: z.strictObject({ answered: z.string() }),
      timeoutMs: 10_000,
      run: (_input, ctx) => checkAPI(ctx.drivers.http),
    })
    .check({
      name: 'host',
      input: noInput,
      data: z.strictObject({ host: z.string(), starts: z.number().int() }),
      timeoutMs: hostCheckTimeoutMs + 5000,
      run: (_input, ctx) => checkHost(parseRunEndpoints(ctx.endpoints), hostCheckTimeoutMs),
    })
    .feature(
      {
        name: 'pull-request-delivery',
        summary:
          "Send a pull request's opened, review and merged webhooks and its release, and read its delivery",
        paths: featurePaths['pull-request-delivery'],
      },
      {
        name: 'session-model-requests',
        summary: "Send a session's telemetry batch, and read its model requests",
        paths: featurePaths['session-model-requests'],
      },
      {
        name: 'entity-neighbourhood',
        summary: 'Read a pull request with get_entity, and walk to the voyage that cites it',
        paths: featurePaths['entity-neighbourhood'],
      },
      {
        name: 'host-restart-recovery',
        summary: 'Stop the host while facts arrive, start it again, and see each fact applied once',
        paths: featurePaths['host-restart-recovery'],
      },
    )
    .shared(...sharedPaths)
    .ignore(...ignoredPaths)
    .build();
}
