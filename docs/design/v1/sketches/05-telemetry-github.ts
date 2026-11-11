// pepys v1, file 5 of 5: the telemetry plug-in, the GitHub release and deploy families and
// tables, and the stage-times query module. Usage first, then types, then flow. Not compiled.
// Every name of a person, a host, a repo and a model is invented.
//
// Home file of: the telemetry and GitHub declarations, TelemetryProduct, LogRecordPayload,
// GithubEventRule, deploySignals, selectPullRequestDelivery.

import { defineConsumer, defineFactFamily, definePlugin, defineQuery, defineSource, defineTable } from '@pepys/kit';
import type { ConsumerDeclaration, DeliveryCheck, FactFamily, OutgoingFact, ReceivePath, SourceDefinition, StoreTables } from './01-kit.ts';
import type { SharedViews } from './04-store-api.ts';
import type { Kysely, RawBuilder } from 'kysely';
import { z } from 'zod';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Usage
// ═════════════════════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Place 1: pepys repo, packages/source-telemetry/src/index.ts (new package)
// ─────────────────────────────────────────────────────────────────────────────────────────────

// The one list of products. A third product is one more entry here, and one more case in each
// consumer's `switch`, which does not compile until the case is there (part 2 of the flow).
export const products = [claudeCode(), codex()] as const;
export type ProductName = (typeof products)[number]['name'];

// One family and one stream: one log record of a known product is one fact, stored whole.
export const logRecordFamily = defineFactFamily({
  stream: 'facts.telemetry.log_record',
  api: 'otlp-logs/1',
  entityKind: 'telemetry:session',
  // `telemetry.<product>.<event>` for each listed event, and `telemetry.<product>.unlisted`
  types: buildLogRecordTypes(products),
});

export const telemetrySource = defineSource({
  name: 'telemetry',
  families: [logRecordFamily],
  // Push only. An OTLP exporter cannot sign a body, so the check is a token.
  live: receiveOtlpLogs({
    // The standard OTLP path at the root. A
    // worker's exporter gets a bare origin (an atc profile's env value holds no path) and adds
    // `/v1/logs`, `/v1/metrics` and `/v1/traces` to it. Ingest serves all three at the root:
    // logs become facts here; `/v1/metrics` and `/v1/traces` pass the same token check, answer
    // 200 with `{}` and store nothing, so an exporter that sends them does not retry for ever.
    route: '/v1/logs',
    ignoredRoutes: ['/v1/metrics', '/v1/traces'],
    check: { kind: 'token', header: 'authorization', secretEnv: 'PEPYS_TELEMETRY_TOKEN' },
    // The route also requires a proven sender (the
    // broker-signed token, through ingest's `SenderProof` port). Each fact then holds who sent
    // it (`payload.origin`), which no guest can write.
    sender: { kind: 'imp-identity', audienceEnv: 'PEPYS_IMP_IDENTITY_AUDIENCE', issuersEnv: 'PEPYS_IMP_IDENTITY_ISSUERS' },
    products,
    // The session of a record is the value of this attribute, read from the OTLP
    // resource first and from the record second. atc stamps it on every record of a session it
    // runs, and boxxy stores the same ID on the attempt. The product's own session ID is the
    // fallback, for an agent that atc did not start.
    sessionAttribute: 'atc.session.id',
    // An exporter picks its own batch size and drops an export that gets a 4xx answer.
    factLimit: 1000,
    bodyByteLimit: 4_194_304,
    // An exporter may compress the body, and expects 200 with `{}` for stored and for ignored.
    encodings: ['gzip'],
    answer: 'empty',
  }),
});

export const telemetryModelRequestConsumer = defineConsumer({
  name: 'telemetry_model_request',
  entry: new URL('./consumers/telemetry-model-request.ts', import.meta.url),
  // Fact mode: one row comes from exactly one fact, and the row's key comes from the fact's ID.
  input: { mode: 'fact', streams: [logRecordFamily.stream] },
  tables: {
    telemetry_model_request: defineTable({
      columns: {
        id: { kind: 'entityID' }, // `telemetry:model_request:<product>.<event>:<key>`
        // THE join key. `telemetry:session:<atc session ID>`, or with the agent's own
        // session ID when the record has no atc session ID. boxxy_attempt_session.session_id
        // holds the same value.
        session_id: { kind: 'entityID' },
        // The agent's own session ID (Claude Code `session.id`, Codex `conversation.id`), as a
        // plain column. It changes inside one atc session, on `/clear`, so nothing joins on it.
        agent_session: { kind: 'text', nullable: true },
        product: { kind: 'text' }, // a ProductName
        model: { kind: 'text' },
        // `input_tokens` never holds a token that the cache read or wrote, for every product.
        input_tokens: { kind: 'integer' },
        cache_read_tokens: { kind: 'integer' },
        cache_creation_tokens: { kind: 'integer' },
        output_tokens: { kind: 'integer' },
        // Null when the product reports no
        // cost for one request. No figure is invented and no 0 stands for "unknown".
        cost_usd: { kind: 'real', nullable: true },
        cost_basis: { kind: 'text' }, // 'reported' | 'none'
        duration_ms: { kind: 'integer', nullable: true },
        agent: { kind: 'text', nullable: true }, // the subagent, when the product names one
        at: { kind: 'timestamp' },
        // the proven sender of the export, from `payload.origin`
        origin_issuer: { kind: 'text' },
        origin_subject: { kind: 'text' },
      },
      primaryKey: ['id'],
      indexes: [{ columns: ['session_id'] }, { columns: ['at'] }],
    }),
  },
  entityViews: [
    { table: 'telemetry_model_request', kind: 'telemetry:model_request', id: 'id', title: 'model', url: null, actor: null, updatedAt: 'at' },
  ],
  reads: [],
  links: [],
});

// The cost a product reports per TURN. Codex writes one
// `codex.turn_cost` record per turn, with its own estimate. A second consumer on the same stream.
export const telemetryTurnCostConsumer = defineConsumer({
  name: 'telemetry_turn_cost',
  entry: new URL('./consumers/telemetry-turn-cost.ts', import.meta.url),
  input: { mode: 'fact', streams: [logRecordFamily.stream] },
  tables: {
    telemetry_turn_cost: defineTable({
      columns: {
        id: { kind: 'entityID' }, // `telemetry:turn_cost:<product>.<event>:<key>`
        session_id: { kind: 'entityID' },
        agent_session: { kind: 'text', nullable: true },
        product: { kind: 'text' },
        // The model of the turn, so a cost report can group turn costs by model. The
        // value of the `model` attribute on the `codex.turn_cost` record; null when it is absent
        // or empty. See "Codex turn cost" in the flow, part 2.
        model: { kind: 'text', nullable: true },
        cost_usd: { kind: 'real' },
        at: { kind: 'timestamp' },
        origin_issuer: { kind: 'text' },
        origin_subject: { kind: 'text' },
      },
      primaryKey: ['id'],
      indexes: [{ columns: ['session_id'] }],
    }),
  },
  // the row is an entity, so its `entityID` key has a kind that the plug-in brings
  entityViews: [{ table: 'telemetry_turn_cost', kind: 'telemetry:turn_cost', id: 'id', title: 'product', url: null, actor: null, updatedAt: 'at' }],
  reads: [],
  links: [],
});

// `telemetry:session` is a kind of this plug-in (the family brings it) with no table: no consumer
// writes a session row in v1. A link may point at a session; `get_entity` finds none.
export const telemetryPlugin = definePlugin({
  name: 'telemetry',
  sources: [telemetrySource],
  consumers: [telemetryModelRequestConsumer, telemetryTurnCostConsumer],
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Place 2: packages/source-telemetry/src/products/<product>/product.ts — the ingest half
// ─────────────────────────────────────────────────────────────────────────────────────────────

function codex() {
  return defineTelemetryProduct({
    name: 'codex',
    // Codex puts the full name in the `event.name` attribute, such as `codex.sse_event`.
    readEvent: (record) => {
      const name = record.attributes['event.name'];

      return typeof name === 'string' && name.startsWith('codex.') ? name.slice('codex.'.length) : undefined;
    },
    agentSessionAttribute: 'conversation.id',
    timeAttribute: 'event.timestamp',
    // The events with a fact type of their own. Any other `codex.*` event is stored as
    // `telemetry.codex.unlisted`. No `key`: the fact ID holds a hash of what Codex wrote.
    events: {
      sse_event: {},
      api_request: {},
      turn_cost: { key: (record) => readText(record, 'turn.id') },
      conversation_starts: {},
      user_prompt: {},
      tool_decision: {},
      tool_result: {},
    },
  });
}

function claudeCode() {
  return defineTelemetryProduct({
    name: 'claude_code',
    // Claude Code puts the short name in `event.name`, such as `api_request`.
    // The wire shape is not checked: an event name with the `claude_code.` prefix, or a scope name
    // that starts with `com.anthropic.claude_code`, marks a Claude Code record.
    readEvent: (record) => {
      const name = readText(record, 'event.name');

      if (name?.startsWith('claude_code.')) {
        return name.slice('claude_code.'.length);
      }

      return record.scope.name.startsWith('com.anthropic.claude_code') ? name : undefined;
    },
    agentSessionAttribute: 'session.id',
    timeAttribute: 'event.timestamp',
    events: {
      // `api_request` and `api_error` can share a request ID; the event name is in the fact ID.
      api_request: { key: (record) => readText(record, 'request_id') ?? readText(record, 'client_request_id') },
      api_error: { key: (record) => readText(record, 'request_id') ?? readText(record, 'client_request_id') },
      api_refusal: { key: (record) => readText(record, 'request_id') },
      user_prompt: {},
      assistant_response: {},
      tool_result: {},
      tool_decision: {},
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Place 3: packages/source-telemetry/src/telemetry-model-request.test.ts
// ─────────────────────────────────────────────────────────────────────────────────────────────
import { expect, test } from 'bun:test';
import { createTestStore } from '@pepys/testing';

test('it gives the same rows for an export sent twice and for records in any order', async () => {
  // the resource of the first export carries `atc.session.id` = 's-9'; the second carries none
  const first = buildLogsExport('claude_code', { 'atc.session.id': 's-9' }, [
    { 'event.name': 'api_request', 'session.id': 'c-1', 'event.timestamp': '2026-11-11T02:20:00.000Z', request_id: 'req_01', model: 'model-large', cost_usd: 0.4, input_tokens: 12, cache_read_tokens: 900, cache_creation_tokens: 30, output_tokens: 210, duration_ms: 4100 },
    { 'event.name': 'api_error', 'session.id': 'c-1', 'event.timestamp': '2026-11-11T02:20:09.000Z', request_id: 'req_01', model: 'model-large' },
  ]);

  const second = buildLogsExport('codex', {}, [
    { 'event.name': 'codex.sse_event', 'event.kind': 'response.completed', 'conversation.id': 'x-4', 'event.timestamp': '2026-11-11T02:21:00.000Z', model: 'model-small', input_token_count: '1000', cached_token_count: 800, output_token_count: '50' },
  ]);

  const options = { products, sessionAttribute: 'atc.session.id' };
  const inOrder = [...readOtlpFacts(first, options).facts, ...readOtlpFacts(second, options).facts];

  await using once = await createTestStore({ plugins: [telemetryPlugin] });
  await using twice = await createTestStore({ plugins: [telemetryPlugin] });

  // the store writes the proven sender into `payload.origin` of each fact, as ingest does
  const sender = { issuer: 'harbour-host', subject: 'imp-0193', name: 'tidy-otter' };

  await once.apply(telemetrySource, inOrder, { sender });
  await twice.apply(telemetrySource, [...inOrder.toReversed(), ...inOrder], { sender });

  expect(await twice.readRows('telemetry_model_request')).toStrictEqual(await once.readRows('telemetry_model_request'));

  // two rows: the api_error shares req_01 and makes no row
  expect(await once.readRows('telemetry_model_request')).toMatchObject([
    { id: 'telemetry:model_request:claude_code.api_request:req_01', session_id: 'telemetry:session:s-9', agent_session: 'c-1', cost_usd: 0.4, cost_basis: 'reported' },
    // no atc session ID on the record: the agent's own ID is the session
    { session_id: 'telemetry:session:x-4', agent_session: 'x-4', product: 'codex', input_tokens: 200, cache_read_tokens: 800, cost_usd: null, cost_basis: 'none' },
  ]);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Place 4: pepys repo, packages/source-github/src/index.ts (changed)
// One webhook route, one table of event rules, seven families, four consumers, one query.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const githubSource = defineSource({
  name: 'github',
  // Webhook event to family (part B has the rules):
  //   pull_request                    facts.github.pull_request          github:pull_request:<id>
  //   release                         facts.github.release               github:release:<id>
  //   push (default branch, or a tag) facts.github.ref                   github:ref:<repository id>:<ref>
  //   deployment, deployment_status   facts.github.deployment            github:deployment:<id>
  //   workflow_run                    facts.github.workflow_run          github:workflow_run:<id>      stored, no consumer
  //   issues                          facts.github.issue                 github:issue:<id>             stored, no consumer
  //   pull_request_review             facts.github.pull_request_review   github:pull_request_review:<id>   stored, no consumer
  // Any other event answers 202 and stores nothing.
  families: [pullRequestFamily, releaseFamily, refFamily, deploymentFamily, workflowRunFamily, issueFamily, pullRequestReviewFamily],
  live: {
    kind: 'receive',
    route: '/webhook/github',
    check: { kind: 'hmac-sha256', header: 'x-hub-signature-256', secretEnv: 'PEPYS_GITHUB_WEBHOOK_SECRET' },
    // GitHub calls from the public internet. This is the one public route of v1.
    reach: 'public',
    read: readGithubDelivery,
  },
  recovery: {
    kind: 'pull',
    name: 'redeliver',
    intervalMs: 3_600_000,
    env: ['PEPYS_GITHUB_APP_ID', 'PEPYS_GITHUB_APP_PRIVATE_KEY'],
    pull: pullFailedDeliveries,
  },
  // Reads each MARKED object again from the GitHub API and writes its
  // current state as one fact (flow part 3, "The resync"). Every minute; no mark, no call.
  resync: {
    kind: 'pull',
    name: 'resync',
    intervalMs: 60_000,
    env: ['PEPYS_GITHUB_APP_ID', 'PEPYS_GITHUB_APP_PRIVATE_KEY'],
    pull: pullMarkedObjects,
  },
});

// github_pull_request: the repo's consumer and columns, with one more table, for a pull request
// that pins a release of another repository.
export const githubPullRequestConsumer = defineConsumer({
  name: 'github_pull_request',
  entry: new URL('./consumers/github-pull-request.ts', import.meta.url),
  input: { mode: 'fact', streams: ['facts.github.pull_request'] },
  tables: {
    github_pull_request: defineTable({
      columns: {
        id: { kind: 'entityID' },
        repository_id: { kind: 'entityID' },
        title: { kind: 'text' },
        url: { kind: 'text' },
        author_id: { kind: 'entityID', nullable: true },
        merge_commit_sha: { kind: 'text', nullable: true },
        merged_at: { kind: 'timestamp', nullable: true },
        updated_at: { kind: 'timestamp' },
        // …and number, state, is_draft, is_merged, created_at, closed_at, payload, as today.
        // No `base_ref` column: no query reads it.
      },
      primaryKey: ['id'],
      indexes: [{ columns: ['repository_id'] }],
    }),
    github_release_bump: defineTable({
      columns: {
        pull_request_id: { kind: 'entityID' },
        release_repository: { kind: 'text' }, // `owner/name`, from the release URL in the body
        release_tag: { kind: 'text' }, // percent-decoded
      },
      primaryKey: ['pull_request_id', 'release_repository', 'release_tag'],
      indexes: [{ columns: ['release_repository', 'release_tag'] }],
    }),
  },
  entityViews: [{ table: 'github_pull_request', kind: 'github:pull_request', id: 'id', title: 'title', url: 'url', actor: 'author_id', updatedAt: 'updated_at' }],
  reads: ['github_pull_request'],
  links: [],
});

export const githubReleaseConsumer = defineConsumer({
  name: 'github_release',
  entry: new URL('./consumers/github-release.ts', import.meta.url),
  input: { mode: 'fact', streams: ['facts.github.release'] },
  tables: {
    github_release: defineTable({
      columns: {
        id: { kind: 'entityID' }, // `github:release:<id>`
        repository_id: { kind: 'entityID' },
        repository_full_name: { kind: 'text' },
        tag_name: { kind: 'text' },
        target_commitish: { kind: 'text' }, // a commit SHA for a release that release-please made
        name: { kind: 'text' },
        url: { kind: 'text' },
        is_draft: { kind: 'boolean' },
        is_prerelease: { kind: 'boolean' },
        created_at: { kind: 'timestamp' },
        published_at: { kind: 'timestamp', nullable: true },
        updated_at: { kind: 'timestamp' },
        // A tombstone. A release that GitHub deleted keeps its row, with the time of the
        // `deleted` fact here. Null for a live release. Once set, no later fact clears it.
        deleted_at: { kind: 'timestamp', nullable: true },
      },
      primaryKey: ['id'],
      indexes: [{ columns: ['repository_id'] }, { columns: ['repository_full_name', 'tag_name'] }],
    }),
  },
  entityViews: [{ table: 'github_release', kind: 'github:release', id: 'id', title: 'name', url: 'url', actor: null, updatedAt: 'updated_at' }],
  reads: ['github_release'],
  links: [],
});

// One row per commit of a push to the default branch, and one for the commit a pushed tag names.
export const githubRefConsumer = defineConsumer({
  name: 'github_ref',
  entry: new URL('./consumers/github-ref.ts', import.meta.url),
  input: { mode: 'fact', streams: ['facts.github.ref'] },
  tables: {
    github_commit: defineTable({
      columns: { repository_id: { kind: 'entityID' }, sha: { kind: 'text' }, committed_at: { kind: 'timestamp' } },
      primaryKey: ['repository_id', 'sha'],
      indexes: [],
    }),
  },
  entityViews: [],
  reads: [],
  links: [],
});

// One list names the signals; the table's column, the
// consumer's `switch` and the query's output enum all come from it.
export const deploySignals = ['tag', 'deployment_status'] as const;
export type DeploySignal = (typeof deploySignals)[number];

// The tag pattern is a setting of the GitHub plug-in.
//   - The default is `deployed/<environment>`. The pattern must hold `<environment>`.
//   - A tag with one more part, `<pattern>/<target>`, names a target: `deployed/production/api`
//     is the environment `production` and the target `api`. The part is optional.
//   - The mapping from a bumped package to a target is out of v1.
// It is a compile-time setting of the kit (01-kit.ts, part G). The
// deployment file gives the value, `checkDeployment` checks it, and `pepys build` bakes it into
// the glue of `github_deploy`, whose entry file imports `settings.deployTagPattern`. Nothing is
// read at run time. A changed pattern is a new version of the consumer.
export const githubSettings = {
  schema: z.object({ deployTagPattern: z.string().includes('<environment>') }),
  defaults: { deployTagPattern: 'deployed/<environment>' },
};

export const githubDeployConsumer = defineConsumer({
  name: 'github_deploy',
  entry: new URL('./consumers/github-deploy.ts', import.meta.url),
  // one consumer, two streams of two families
  input: { mode: 'fact', streams: ['facts.github.ref', 'facts.github.deployment'] },
  tables: {
    github_deploy: defineTable({
      columns: {
        // `github:deploy:<repository id>:<environment>:<signal>:<sha>`. A row with
        // a target ends `:<sha>:<target>`, so two targets of one commit do not share a row.
        id: { kind: 'entityID' },
        repository_id: { kind: 'entityID' },
        environment: { kind: 'text' },
        // The third part of the tag, or null. A `deployment_status` row has null.
        target: { kind: 'text', nullable: true },
        sha: { kind: 'text' },
        signal: { kind: 'text' }, // a DeploySignal
        deployed_at: { kind: 'timestamp' }, // the earliest time this signal reported this commit
      },
      primaryKey: ['id'],
      indexes: [{ columns: ['repository_id', 'environment'] }],
    }),
  },
  // The row is an entity (`github:deploy`), so the kind has an owner and the `id`
  // that the query returns can be passed to `get_entity`.
  entityViews: [{ table: 'github_deploy', kind: 'github:deploy', id: 'id', title: 'sha', url: null, actor: null, updatedAt: 'deployed_at' }],
  // it reads its own row, to keep the earliest time
  reads: ['github_deploy'],
  links: [],
});

// The consumers that the delivery tie reads. Another plug-in's query passes this as its `reads`.
export const githubDeliveryConsumers = [githubPullRequestConsumer, githubReleaseConsumer, githubRefConsumer, githubDeployConsumer] as const;

const pullRequestDeliveryQuery = defineQuery({
  name: 'github_pull_request_delivery',
  description:
    'Returns, for each pull request, when it merged, the first release of its repository that contains it, and the first deploy to one environment of a commit that pins such a release. With a target, only a deploy of that target counts.',
  // `target` is optional. Absent: a deploy of any target, and of none, counts.
  input: z.object({ pullRequests: z.array(z.string()).max(200), environment: z.string(), target: z.string().optional() }),
  output: z.array(
    z.object({
      pullRequest: z.string(),
      mergedAt: z.string().nullable(),
      release: z.object({ id: z.string(), tag: z.string(), at: z.string() }).nullable(),
      deploy: z.object({ id: z.string(), at: z.string(), signal: z.enum(deploySignals) }).nullable(),
    }),
  ),
  reads: githubDeliveryConsumers,
  // An empty list answers [] with no statement.
  handler: async (call) => {
    const [first, ...rest] = call.input.pullRequests;
    if (first === undefined) return [];
    const result = await selectPullRequestDelivery({ pullRequests: [first, ...rest], environment: call.input.environment, target: call.input.target }).execute(call.db);
    return parsePullRequestDeliveries(result.rows);
  },
});

// One plug-in for every deployment. A deployment that uses another tag pattern sets
// `settings.github.deployTagPattern` in its deployment file.
export const githubPlugin = definePlugin({
  name: 'github',
  settings: githubSettings,
  sources: [githubSource],
  consumers: [...githubDeliveryConsumers],
  queries: [pullRequestDeliveryQuery],
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Place 5 (invented): boxxy repo, the query `boxxy_stage_time` — how another plug-in uses the module
//
// The query is the boxxy pepys package's, in the boxxy repo's sketch of the package. Its
// contract, as that sketch has it:
//
//   input    { item: string,          the item, as `boxxy:item:<id>`
//              environment: string }  REQUIRED, no default: the environment whose deploy counts,
//                                     such as `production`. boxxy's config holds it
//                                     (`pepys.environment`) and its reader passes it.
//   output   { item, environment,
//              steps: [ { step: 'triage' | 'design' | 'build' | 'review' | 'merge' | 'release' | 'deploy',
//                         minutes: number | null, endedAt: string | null } × 7 ],
//              rework: { count: number, minutes: number },
//              reviewWaitMinutes: number | null, sleepMinutes: number,
//              pullRequests: string[] }
//   reads    [boxxyWorkConsumer, ...githubDeliveryConsumers]
//
// The first four steps come from boxxy's own `boxxy_attempt` rows. The last three come from this
// plug-in's module, with the SAME `environment`, through boxxy's own `produced` link:
// ─────────────────────────────────────────────────────────────────────────────────────────────
import type { boxxyWorkConsumer } from './01-kit.ts';

declare const stageTimeCall: { db: Kysely<StoreTables<readonly [typeof boxxyWorkConsumer, ...typeof githubDeliveryConsumers]> & SharedViews>; input: { item: string; environment: string } };

// The pull requests of the item first, through boxxy's `produced` link; then one
// PullRequestDelivery per pull request from the module.
const produced = await stageTimeCall.db
  .selectFrom('link_effective as produced')
  .innerJoin('boxxy_attempt as attempt', 'attempt.id', 'produced.from_id')
  .where('produced.type', '=', 'produced')
  .where('attempt.item_id', '=', stageTimeCall.input.item)
  .select('produced.to_id as pullRequest')
  .execute();
const [first, ...rest] = produced.map((row) => row.pullRequest);
const result = first === undefined ? undefined : await selectPullRequestDelivery({ pullRequests: [first, ...rest], environment: stageTimeCall.input.environment }).execute(stageTimeCall.db);
const deliveries = result === undefined ? [] : parsePullRequestDeliveries(result.rows);
// merge = `mergedAt`; release = `release.at`; deploy = `deploy.at`. An item with two pull requests
// takes the earliest of each. The module's own contract does not change: `options.environment`
// is required, and it returns the three times per pull request, not the seven steps.
// `options.target` is optional. boxxy passes none in v1.
void deliveries;

// Place 6: what an agent's machine sets, to send to the route of place 1.
//   Claude Code (environment): CLAUDE_CODE_ENABLE_TELEMETRY=1, OTEL_LOGS_EXPORTER=otlp,
//     OTEL_EXPORTER_OTLP_LOGS_PROTOCOL=http/json,
//     OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=https://ingest.pepys.example/v1/logs,
//     OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <token>
//   A worker session in an imp sets neither of the last two. Its atc
//   profile gives the bare origin of the broker's made-up host (OTEL_EXPORTER_OTLP_ENDPOINT),
//   the exporter adds `/v1/logs`, and the broker adds the token.
//   Codex (config.toml): [otel] exporter = { otlp-http = { endpoint = "<the same URL>",
//     protocol = "json", headers = { "authorization" = "Bearer <token>" } } }
//   atc adds `atc.session.id=<atc session ID>` to OTEL_RESOURCE_ATTRIBUTES of every agent it starts.

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Types
// ═════════════════════════════════════════════════════════════════════════════════════════════

// ── A. Telemetry — packages/source-telemetry/src ───────────────────────────────────────────────

// The body of an OTLP/HTTP logs export in its JSON form. Only the fields ingest reads are typed.
export interface LogsExport {
  resourceLogs: readonly {
    resource?: { attributes?: readonly OtlpKeyValue[] };
    scopeLogs: readonly { scope?: { name?: string; version?: string }; logRecords: readonly OtlpLogRecord[] }[];
  }[];
}

export interface OtlpKeyValue {
  key: string;
  value: OtlpAnyValue;
}

// OTLP JSON writes a 64-bit integer as a string, so `intValue` may be text.
export type OtlpAnyValue =
  | { stringValue: string }
  | { intValue: string | number }
  | { doubleValue: number }
  | { boolValue: boolean }
  | { arrayValue: { values: readonly OtlpAnyValue[] } }
  | { kvlistValue: { values: readonly OtlpKeyValue[] } };

export interface OtlpLogRecord {
  timeUnixNano?: string;
  observedTimeUnixNano?: string;
  body?: OtlpAnyValue;
  attributes?: readonly OtlpKeyValue[];
}

// What a product's functions get: one record with its attributes as plain maps. Never stored.
export interface LogRecord {
  scope: { name: string };
  resource: Readonly<Record<string, string | number | boolean>>;
  attributes: Readonly<Record<string, string | number | boolean>>;
  raw: OtlpLogRecord;
}

// The payload of every telemetry fact: what the exporter wrote, whole. A consumer reads the
// product and the event from the fact's `type`, and the session from the fact's `entity`.
export interface LogRecordPayload {
  resource: { attributes: readonly OtlpKeyValue[] };
  scope: { name: string; version?: string };
  logRecord: OtlpLogRecord;
  // Who sent the export, from `Delivery.sender`.
  // The only part of the payload that the sender did not write. It is not in the fact ID,
  // which depends on the record alone.
  origin: { issuer: string; subject: string };
}

// The ingest half of a product. It holds no row shape.
export interface TelemetryProduct<Name extends string = string, Event extends string = string> {
  readonly name: Name; // the `product` column, and the middle part of every fact type
  // the short event name when the record is this product's; the first product that answers owns it
  readonly readEvent: (record: LogRecord) => string | undefined;
  // the attribute that holds the agent's own session ID
  readonly agentSessionAttribute: string;
  // the attribute that holds the time the product wrote; `timeUnixNano` when it is absent
  readonly timeAttribute: string;
  readonly events: Readonly<Record<Event, { readonly key?: (record: LogRecord) => string | undefined }>>;
}

export declare function defineTelemetryProduct<const Name extends string, const Event extends string>(product: TelemetryProduct<Name, Event>): TelemetryProduct<Name, Event>;

export declare function buildLogRecordTypes<const Products extends readonly TelemetryProduct[]>(
  products: Products,
): { [Product in Products[number] as `telemetry.${Product['name']}.${(keyof Product['events'] & string) | 'unlisted'}`]: z.ZodType<LogRecordPayload> };

// The receive path. Its `read` parses the body (ingest has decoded it) and calls readOtlpFacts.
export declare function receiveOtlpLogs(
  receiver: Pick<ReceivePath, 'route' | 'ignoredRoutes' | 'bodyByteLimit' | 'factLimit' | 'encodings' | 'answer' | 'reach' | 'sender'> & {
    check: DeliveryCheck;
    products: readonly TelemetryProduct[];
    sessionAttribute: string;
  },
): ReceivePath;

// Why a record made no fact. A dropped record never refuses the export it came in.
export type DroppedRecord =
  | { reason: 'unknown-product' }
  // neither the session attribute nor the product's own session attribute has a value
  | { reason: 'no-session'; product: string; event: string }
  | { reason: 'no-time'; product: string; event: string };

// Pure. The facts come out in the form a fact batch sender writes, so a test hands them to the
// test store as they are.
export declare function readOtlpFacts(
  body: LogsExport,
  options: { products: readonly TelemetryProduct[]; sessionAttribute: string },
): { facts: readonly OutgoingFact<SourceDefinition>[]; dropped: readonly DroppedRecord[] };

// The consumer half of a product (consumers/products/<product>.ts; plain functions, no zod).
export interface ModelRequestFields {
  agent_session: string | null;
  model: string;
  input_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  output_tokens: number;
  reported_cost_usd: number | null; // null when the product reports no cost for one request
  duration_ms: number | null;
  agent: string | null;
}

// Which record is one model request:
//   claude_code   type `telemetry.claude_code.api_request`: the model, the counts, `cost_usd`.
//   codex         type `telemetry.codex.sse_event` whose `event.kind` is `response.completed` and
//                 which has `input_token_count`. No cost on it.
export declare function readClaudeCodeModelRequest(payload: LogRecordPayload): ModelRequestFields | undefined;
export declare function readCodexModelRequest(payload: LogRecordPayload): ModelRequestFields | undefined;

// ── B. GitHub — packages/source-github/src ─────────────────────────────────────────────────────

// Each family's `types` lists `github.<family>.<action>`; the payload schema is z.unknown(), and
// the delivery body is stored whole.
// The fact ID is `webhook:github:h-<sha256>` for every rule, where the hash is over the canonical
// JSON of the body (keys sorted, no white space). It is never the delivery ID from
// `x-github-delivery`: GitHub signs the body only, so with that ID anyone who held one signed
// body could send it again under a new delivery ID and get a new fact.
declare const pullRequestFamily: FactFamily; //       facts.github.pull_request          kind github:pull_request
declare const releaseFamily: FactFamily; //           facts.github.release               kind github:release
declare const refFamily: FactFamily; //               facts.github.ref                   kind github:ref
declare const deploymentFamily: FactFamily; //        facts.github.deployment            kind github:deployment
declare const workflowRunFamily: FactFamily; //       facts.github.workflow_run          kind github:workflow_run
// v1 stores the facts of issues and reviews, with no consumer. They are
// stored from the first day, because GitHub redelivers only 3 days back. Their tables are not designed.
declare const issueFamily: FactFamily; //             facts.github.issue                 kind github:issue
declare const pullRequestReviewFamily: FactFamily; // facts.github.pull_request_review   kind github:pull_request_review

// packages/source-github/src/ingest/event-rules.ts — one rule per webhook event name.
export interface GithubEventRule {
  readonly family: FactFamily;
  // `ignored`: a delivery pepys does not keep, such as a push to a feature branch.
  // `invalid`: the body is not what the event documents; the route answers 422.
  // `locator`: the API path the resync pull reads the entity at, from the body's `url`.
  readonly read: (body: unknown) => { type: string; entity: string; actor: string | undefined; at: string; locator: string | undefined } | 'ignored' | 'invalid';
}

// pull_request, release, push, deployment, deployment_status, workflow_run, issues, pull_request_review
export declare const githubEventRules: Readonly<Record<string, GithubEventRule>>;

declare const readGithubDelivery: ReceivePath['read'];
declare const pullFailedDeliveries: NonNullable<SourceDefinition['recovery']>['pull'];
declare const pullMarkedObjects: NonNullable<SourceDefinition['resync']>['pull'];

// packages/source-github/src/queries/select-pull-request-delivery.ts — the stage-times query
// module. The one place that holds the tie rules. A plain typed module: a query of any plug-in
// whose `reads` holds githubDeliveryConsumers runs the statement on its `db` and parses the rows.
// The statement is raw SQL: the tie's correlated subqueries do not type in Kysely's builder.
export interface PullRequestDelivery {
  pullRequest: string;
  mergedAt: string | null;
  release: { id: string; tag: string; at: string } | null;
  deploy: { id: string; at: string; signal: DeploySignal } | null;
}

export declare function selectPullRequestDelivery(options: {
  pullRequests: readonly [string, ...string[]];
  environment: string;
  target?: string;
}): RawBuilder<unknown>;

export declare function parsePullRequestDeliveries(rows: unknown): PullRequestDelivery[];

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Flow
// ═════════════════════════════════════════════════════════════════════════════════════════════

// ── 1. One OTLP export becomes facts (ingest) ──────────────────────────────────────────────────
//
// Ingest has checked the method, the size and the token, and has unpacked a gzip body (file 2).
// The path's `read`:
//   a. `content-type` must be `application/json`. Protobuf is `refused` 400.
//   b. The body parses as a LogsExport, or `refused` 400. Only a body that is no export at all is
//      refused: an exporter drops an export on a 4xx answer.
//   c. readOtlpFacts. For each log record:
//        - the first product whose `readEvent` answers owns it; none: dropped, `unknown-product`.
//        - the session: `sessionAttribute` on the resource, then on the record, then the
//          product's `agentSessionAttribute`. None of the three: dropped, `no-session`.
//          The entity is `telemetry:session:<that value>`.
//        - the time: the product's `timeAttribute`, then `timeUnixNano`; never the time ingest
//          read it. Neither: dropped, `no-time`.
//        - the type: `telemetry.<product>.<event>`, or `.unlisted` for an event the product does
//          not list.
//        - the fact ID: `event:telemetry:<product>.<event>:<key>`. <key> is the event's own `key`
//          when it gives one, such as `req_01`. Else `h-<sha256>` of what the product wrote: the
//          agent's own session ID, the event name, `timeUnixNano`, the body, and the attributes
//          sorted by name. The resource and `observedTimeUnixNano` stay out, because a sink that
//          forwards a record may set both again. The ID depends on the record alone, so a repeat
//          of an export and a record that a later export carries again give one ID.
//        The session comes from attributes that the SENDER writes, so
//        the session of a record proves nothing. What is proven is the sender: `read` copies
//        `Delivery.sender` into `payload.origin` of every fact of the export (a path with `sender` never
//        calls `read` without one). Ingest keeps no
//        list of sessions and asks neither boxxy nor atc, so it does not drop a record whose
//        session is another sender's; it stores the record with its true origin. The reader
//        drops it: a query counts a telemetry row for a session only when the row's origin is
//        the caller that a boxxy fact gives for that session (the cost query in the boxxy repo's sketch of its pepys package).
//        The sender still writes the time (`at`). See docs/design/v1-open.md, "Known limits".
//   d. No fact at all: `ignored`. Ingest answers 200 with `{}` for stored and for ignored.
// A dropped record is logged with its reason. Up to 1000 facts of one export go to one stream;
// ingest cuts them into appends as file 2, part 3, says, and a failed append answers 503.

// ── 2. One telemetry fact becomes one row, or nothing (the consumers) ──────────────────────────

// consumers/telemetry-model-request.ts. The host calls it once per fact ID (`applied_facts`), so
// a copy never gets here. The row's key comes from the fact's ID, so order changes nothing.
export function applyFact(factJSON: string): string {
  const fact = parseFact(factJSON);
  const [, product, event] = fact.type.split('.');
  const fields = readModelRequest(product as ProductName, event ?? '', fact.payload);

  if (fields === undefined) {
    return '[]';
  }

  const { reported_cost_usd, ...columns } = fields;

  return JSON.stringify([
    {
      upsert: {
        telemetry_model_request: {
          ...columns,
          id: `telemetry:model_request:${fact.id.slice('event:telemetry:'.length)}`,
          // ingest chose the session; the consumer copies the entity and reads no attribute for it
          session_id: fact.entity,
          // The proven sender. Two text columns on this table and on
          // `telemetry_turn_cost`: `origin_issuer`, `origin_subject`.
          origin_issuer: fact.payload.origin.issuer,
          origin_subject: fact.payload.origin.subject,
          product,
          cost_usd: reported_cost_usd,
          cost_basis: reported_cost_usd === null ? 'none' : 'reported',
          at: fact.at,
        },
      },
    },
  ]);
}

// One case per product. `ProductName` is a type import, so the consumer imports no ingest code.
// A product in the list with no case here fails the build: the `never` line does not compile.
function readModelRequest(product: ProductName, event: string, payload: LogRecordPayload): ModelRequestFields | undefined {
  switch (product) {
    case 'claude_code':
      return event === 'api_request' ? readClaudeCodeModelRequest(payload) : undefined;
    case 'codex':
      return event === 'sse_event' ? readCodexModelRequest(payload) : undefined;
    default: {
      const unhandled: never = product;

      void unhandled;

      return undefined;
    }
  }
}

// consumers/telemetry-turn-cost.ts has the same shape, with one case that returns a row:
// `telemetry.codex.turn_cost` gives { id, session_id: fact.entity, agent_session, product, model,
// cost_usd: the number in `usage.estimated_usd`, at }. A record with no number makes no row.
//
// Codex turn cost: does `codex.turn_cost` carry a model? From a report of the Codex source (the
// source itself was not read for this sketch):
//   - the event's OWN attributes are `turn.id`, `usage.estimated_usd`, `turn.interrupted`,
//     `speed` and `reasoning_effort`. No model among them.
//   - the report's second lookup says that the macro that writes every Codex LOG event adds
//     common attributes to each one, and `model` and `slug` are in that list.
// So a `codex.turn_cost` record carries `model` as a common attribute, and the column is added.
// It is the session's model when the record is written: a turn that used two models has one
// name. The column is nullable because the claim rests on that report, not on a captured record.
//
// Codex token counts (readCodexModelRequest): Codex writes some counts as text and some as
// integers, and counts the cached tokens inside its input count. `input_tokens` is
// `max(input_token_count - cached_token_count, 0)`.

// ── 3. One GitHub delivery becomes one fact (ingest) ───────────────────────────────────────────
//
// `readGithubDelivery`: the rule of the
// `x-github-event` header, or `ignored`; no `x-github-delivery`: 400; a body that is not JSON: 400;
// the rule's `read`; one fact.
// The fact's ID is `webhook:github:h-<sha256 of the canonical JSON of the
// body>`. Only the body is signed, so only the body may decide the ID.
//   - A redelivery by GitHub sends the same body, so it keeps the ID.
//   - A replay of a captured body gives the same ID under any `x-github-delivery` and any
//     `x-github-event`, so it is a copy, and every consumer drops it.
//   - The recovery pull hashes the same canonical form, so one delivery has one ID on both
//     paths. assumed: the body that GitHub's deliveries API returns parses to the same JSON
//     value as the body it sent.
//   - The delivery ID is still required and goes to ingest's log line with the fact ID. It is
//     in no fact and decides nothing.
//   - The cost: two deliveries with the same body are one fact. They say the same thing, with
//     one exception: a state that goes A, B, A with equal bodies for both A deliveries. The
//     second A is a copy and is dropped, so the row would stay at B.
//   The resync. Ingest MARKS an object (an entity ID) in two cases:
//     1. it drops a delivery as a copy of an earlier body, and another body for the same
//        object was stored between the two;
//     2. it stores a body whose fact has the same `at` (`updated_at`) as the last body it
//        stored for the same object, and the two bodies differ (a tie).
//   An A, B, A with equal A bodies always meets case 2 at B (equal bodies have one
//   `updated_at`, and B lies between), and case 1 at the second A.
//   The `resync` pull takes the marks. For each marked pull request or release it reads the
//   object from the GitHub API with the App's token and writes ONE fact: type
//   `github.<family>.resynced`, the same entity, `at` = the object's `updated_at`, the payload
//   in the shape of a webhook body (`{ action: 'resynced', <object> }`, and for a release the
//   `repository` with its ID and full name, which the release API leaves out), ID
//   `observation:<sha256 of the canonical payload>`. It arrives after the deliveries, so by the
//   tie rule (part 4) it wins a tie and sets the row to GitHub's current state. Two resyncs
//   of one unchanged state are one fact. A 404 writes nothing: GitHub deletes no pull request,
//   and shows a draft release only to a token that can push, so a 404 proves no delete. A
//   deleted release's own `deleted` delivery sets its tombstone. The pull also skips a mark with
//   no locator and a repository with no App installation; ingest removes those marks. Each family's `types` gains `github.<family>.resynced`.
//   A replay cannot use this to set a row: the resync fact holds what GitHub's API says at
//   that time, never what the replayed body says. A replay can only cause one API read.
//   Limits: the marks and `lastBodies` are in ingest's memory. A restart between the first A
//   and the second loses case 1; case 2 was already marked at B unless the restart came before
//   the resync ran. After one hour the copy is not seen as a copy by ingest (step c2), and the
//   host drops it with no mark. The next delivery for the object, or a resync, mends the row.
//   assumed: the App's token may read a pull request and a release; `observation:` IDs pass
//   the envelope check (they do in the repo: parse-fact-envelope.ts).
//   Test (packages/source-github/src/ingest/resync/pull-marked-objects.test.ts): three deliveries for one release
//   in one second: A (draft), B (published), then A again with the body of the first A. After
//   B: the release is marked. After the second A: 200, no new fact, still marked. The resync
//   pull, with the API stub answering A: one `github.release.resynced` fact, and the row is a
//   draft. A second test: the third delivery is a replay by a stranger while GitHub's state is
//   B: the API stub answers B, and the row stays published.
//   - The ID form passes the envelope check as it is: `^webhook:[a-z][a-z0-9_]*:.+$`.
//   pull_request         type github.pull_request.<action>; at pull_request.updated_at
//   release              type github.release.<action>; at release.updated_at, else published_at,
//                        else created_at
//   push                 kept when `ref` is the default branch or starts with `refs/tags/`;
//                        type github.ref.pushed; at the push time, else head_commit.timestamp
//   deployment           type github.deployment.created
//   deployment_status    type github.deployment.status_created; the same family and entity
//   workflow_run, issues, pull_request_review     stored; no consumer in v1

// ── 4. The GitHub consumers ────────────────────────────────────────────────────────────────────
//
//   THE TIE RULE for every table below that compares `updated_at`: a fact wins when
//   its `updated_at` is NEWER than the stored row's, or EQUAL to it, or no row is stored. It
//   loses only when it is older. So on a tie the later fact in the stream wins. This is
//   `isStale` of the repo's github-pull-request.ts, which says that two updates can share one
//   second. The host gives each fact ID to the consumer once, so "later in the stream" is one
//   order on every replay.
//   "Later in the stream" means the FIRST copy of each fact ID. A body
//   that is sent again, by GitHub or by anyone who holds it, has the ID of its first copy (part
//   3), and the host skips it. So a replay of the older of two updates with one `updated_at`
//   cannot win the tie back. Test: two release updates with one `updated_at`; then the first
//   body again with a new `x-github-delivery`; the row keeps the second update.
//   With "newer" alone, a release that was created as a
//   draft and published in the same second would stay a draft for good.
//   github_pull_request  as today (the newest `updated_at` wins; the tie rule). For a pull request whose author
//                        is a bot: one github_release_bump row per
//                        `https://github.com/<owner>/<name>/releases/tag/<tag>` URL in its body.
//                        The bump rows follow the pull request row. A fact that loses
//                        the `updated_at` comparison (it is older; a tie wins) writes nothing,
//                        bump rows included. A fact
//                        that wins writes the bump rows of its body and deletes the bump rows of
//                        the body it replaces, which it reads from the stored row's `payload`.
//                        So an older delivery that arrives late cannot bring back a bump that a
//                        newer body dropped.
//   github_release       one row per release, and the row is never deleted. The consumer
//                        reads its own row and joins it with the fact:
//                          - `deleted_at`: the stored value when it is set; else the fact's time
//                            when the fact is `github.release.deleted`; else null. A tombstone
//                            is never cleared (GitHub does not use a release ID again).
//                          - every other column: from the fact when it wins by the tie rule
//                            (newer, or equal, or no row); else the stored values.
//                        `deleted_at` is the same for one set of facts in any order:
//                        [deleted, then an older published] and [published, then deleted] both
//                        end as one row with `deleted_at` set. The other columns are the same
//                        in any order too, except between two facts with one `updated_at`:
//                        there the later one in the stream wins, which is the same on every
//                        replay of one log. Every reader of the table filters on
//                        `deleted_at is null`; the tie in part 5 does.
//   github_ref           one github_commit row per entry of `commits` for a default branch push,
//                        and one for `head_commit` of a tag push. A commit's row never changes.
//   github_deploy        a `switch` over DeploySignal:
//                          'tag'                a `github.ref.pushed` fact that moves a tag
//                                               that matches `settings.deployTagPattern` of the glue
//                                               (default `deployed/<environment>`) to a commit.
//                                               a third part of the tag is the
//                                               row's `target`; with none, `target` is null
//                          'deployment_status'  a `github.deployment.status_created` fact with
//                                               state `success`. Its `target` is null
//                        The row's ID holds the repository, the environment, the signal and the
//                        commit, and the target when the row has one.
//                        The consumer reads its own row and keeps the earliest time, so a
//                        second report of one commit, in any order, changes nothing.

// Every table of this file, checked for a row that depends on the arrival order (a
// delete, or a newer state that an older fact can overwrite):
//   github_pull_request    safe: the newest `updated_at` wins (a tie goes to the later
//                          fact), and GitHub deletes no pull request.
//   github_release_bump    safe: its rows follow the pull request row's time comparison.
//   github_release         safe: the row is never deleted, so a late fact has a row to compare with.
//   github_commit          safe: insert only. A commit's time is a property of the commit, and a
//                          force push that drops a commit leaves a row that is still true.
//   github_deploy          safe: the row says "this signal reported this commit", and keeps the
//                          minimum time. A later `failure` status does not unsay an earlier
//                          `success`, and a `deployment_status` fact holds its deployment whole,
//                          so it needs no `deployment.created` fact before it. A push that
//                          deletes the tag names no commit and makes no row.
//   telemetry_model_request, telemetry_turn_cost    safe: insert only, one row per fact, the key
//                          from the fact ID, and no fact changes or deletes a row.
// The entity view of github_release still shows a deleted release, with its row; `get_entity`
// returns it with `deleted_at` set.

// ── 5. The tie: merge, release, deploy (the query module) ──────────────────────────────────────
//
// The tie is made when a query runs, never when a fact arrives. Each table is built from the
// facts of one entity, so each is right in any arrival order, and the tie over them is too. v1
// writes no link for it: a scope consumer wakes on facts of its own scope kind only, and the tie
// spans four entities. So `neighbourhood` does not show a pull request's release.
//
//   commit time   `github_commit.committed_at` for (repository, sha). Where the push fact is
//                 absent, the row's own time stands in: `merged_at`, `created_at`, `deployed_at`.
//   merge         `github_pull_request.merged_at`.
//   release       A release R of the pull request's repository CONTAINS it when R is published,
//                 is no draft, is not deleted (`deleted_at` is null), and the commit time of `R.target_commitish` is at or after the
//                 commit time of the pull request's `merge_commit_sha`. The first release is the
//                 containing one with the earliest commit time; its time is `published_at`.
//   deploy        A pull request B PINS R when a github_release_bump row of B names R's
//                 `repository_full_name` and `tag_name`, and B is merged. A deploy D CARRIES B
//                 when D is in B's repository, D's environment is the one asked for, and the
//                 commit time of `D.sha` is at or after the commit time of B's merge commit. The
//                 deploy time is the earliest `deployed_at` of a D that carries a B that pins an
//                 R that contains the pull request.
//   which signal  For one repository and environment: the 'tag' rows when it has any; else its
//                 'deployment_status' rows. The order of trust is the order of `deploySignals`.
//   which target  No `target` asked: every row of the environment counts, with a
//                 target or with none. A `target` asked: only the rows with that target count,
//                 so a `deployment_status` row (target null) never counts, and "which signal"
//                 is then read over the rows of that target.
//
// Columns the module reads, and the consumer that writes each (checked against the declarations
// above): github_pull_request.{id, repository_id, merge_commit_sha, merged_at} and
// github_release_bump.* (github_pull_request); github_release.{id, repository_id,
// repository_full_name, tag_name, target_commitish, is_draft, published_at, created_at, deleted_at}
// (github_release); github_commit.* (github_ref); github_deploy.* (github_deploy).

// ── Everything below decides no order. ────────────────────────────────────────────────────────

declare function readText(record: LogRecord, attribute: string): string | undefined;
declare function buildLogsExport(product: ProductName, resource: Readonly<Record<string, string>>, records: readonly Readonly<Record<string, string | number>>[]): LogsExport;
declare function parseFact(factJSON: string): { id: string; type: string; entity: string; at: string; payload: LogRecordPayload };

void [applyFact, githubEventRules];
export type { ConsumerDeclaration };
