// pepys v1, file 1 of 5: the kit, as a plug-in author and a deployment see it.
// Usage first (places 1 to 4), then the types (parts A to H). Not compiled or type-checked.
// Every name of a person, a host, a repo and a model is invented.
//
// One home file per shared type. The other files import it and never define it again:
//   01-kit.ts               every declaration type, the checks, the test store, `pepys build`
//   02-ingest-log.ts        the receive route, FactLog, the batch appender
//   03-manifest-host.ts     consumers.json, the wire operations, the Rust host
//   04-store-api.ts         StoreReader, SharedViews, LinkRow, the link check, the core queries
//   05-telemetry-github.ts  the telemetry and GitHub plug-ins, the stage-times query module
//
// The design doc is docs/design/v1.md. docs/design/v1-open.md lists what is open and what no run
// has checked.

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Place 1 (invented): boxxy repo, packages/pepys/src — the package `@boxxy/pepys`, ABRIDGED
//
// A short cut of the real package, with the real names. The whole package is in the boxxy repo,
// under docs/design/boxxy/sketches/v1:
//   pepys-package/01-package.ts   the family, the source, the consumer, the entry file
//   pepys-package/02-queries.ts   `boxxy_cost_to_land` and `boxxy_stage_time`
//   pepys-package/04-test.ts      the tests
//   core/04-facts.ts              the catalog: the 27 fact types and their payloads
// Where this cut and those files differ, those files are right.
// ─────────────────────────────────────────────────────────────────────────────────────────────
import { defineConsumer, defineFactFamily, defineLinkType, definePlugin, defineSource, defineTable, receiveFactBatch } from '@pepys/kit';
import { z } from 'zod';

// boxxy repo, libs/model: one zod schema per fact type of the catalog, declared once.
declare const workFactSchemas: {
  'boxxy.item.filed': z.ZodObject; // kind, repo, title, fields (designMode), …
  'boxxy.attempt.claimed': z.ZodObject; // attempt, phase, number, round, mode, pool, recipeHash, rulesVersion, …
  // `atcSession` is the atc session ID of the attempt's session. The telemetry
  // plug-in keys a session on the same ID, so one join finds every model request of the attempt.
  'boxxy.attempt.started': z.ZodObject; // attempt, atcSession
  'boxxy.attempt.session_bound': z.ZodObject; // attempt, atcSession, agentSession, product, source, seenAt
  'boxxy.pull_request.linked': z.ZodObject; // attempt, repo, number, url, pullRequestId (GitHub's own `pull_request.id`, as decimal text), source
  // …and 22 more
};

export const workFamily = defineFactFamily({
  stream: 'facts.boxxy.work',
  api: 'boxxy/1',
  // Every fact names an item as its `entity`; the attempt is in the payload. One item is one scope.
  entityKind: 'boxxy:item',
  // one zod schema per fact type; the sender, the receiver and the glue generator read the same one
  types: workFactSchemas,
});

export const boxxySource = defineSource({
  name: 'boxxy',
  families: [workFamily],
  live: receiveFactBatch({
    route: '/boxxy/facts',
    check: { kind: 'hmac-sha256', header: 'x-boxxy-signature-256', secretEnv: 'PEPYS_BOXXY_SIGNING_SECRET' },
    // `factLimit` (100), `reach` ('private'), `answer` ('status') and `encodings` ([]) keep
    // their defaults. See ReceivePath in part C.
  }),
});

const ranIn = defineLinkType({ name: 'ran_in', from: ['boxxy:attempt'], to: ['telemetry:session'], hub: false });
const produced = defineLinkType({ name: 'produced', from: ['boxxy:attempt'], to: ['github:pull_request'], hub: false });
// A structural link, so `neighbourhood` reaches an attempt from its item. Without it a walk from
// an item returns the item alone.
const attemptOf = defineLinkType({ name: 'attempt_of', from: ['boxxy:attempt'], to: ['boxxy:item'], hub: false });

export const boxxyWorkConsumer = defineConsumer({
  name: 'boxxy_work',
  entry: new URL('./consumers/boxxy-work.ts', import.meta.url),
  input: { mode: 'scope', scopeKind: 'boxxy:item', streams: [workFamily.stream] },
  tables: {
    // 9 columns in the package; these are 4 of them
    boxxy_item: defineTable({
      columns: { id: { kind: 'entityID' }, title: { kind: 'text' }, filed_at: { kind: 'timestamp' }, updated_at: { kind: 'timestamp' } },
      primaryKey: ['id'],
      indexes: [],
    }),
    // 20 columns in the package; these are 10 of them. `outcome` is a name of the phase kind's
    // list (such as `built` or `passed`), or `lost`. No column says "landed": a query reads that
    // from the GitHub tables.
    boxxy_attempt: defineTable({
      columns: {
        id: { kind: 'entityID' },
        item_id: { kind: 'entityID' },
        phase: { kind: 'text' },
        number: { kind: 'integer' },
        round: { kind: 'integer' },
        state: { kind: 'text' },
        outcome: { kind: 'text', nullable: true },
        claimed_at: { kind: 'timestamp' },
        ended_at: { kind: 'timestamp', nullable: true },
        updated_at: { kind: 'timestamp' },
      },
      primaryKey: ['id'],
      indexes: [{ columns: ['item_id'] }],
    }),
    // Whole, and the ONE shape of this table: the boxxy pepys package's. One row per
    // (attempt, telemetry session). It is the join table of the cost query.
    boxxy_attempt_session: defineTable({
      columns: {
        attempt_id: { kind: 'entityID' },
        // `telemetry:session:<atc session ID>` on a row with key 'atc';
        // `telemetry:session:<agent session ID>` on a row with key 'agent'
        session_id: { kind: 'entityID' },
        key: { kind: 'text' }, // 'atc' | 'agent'
        product: { kind: 'text', nullable: true }, // from `session_bound`; null on an 'atc' row
        bound_at: { kind: 'timestamp' }, // the `at` of the earliest fact that names the pair
      },
      primaryKey: ['attempt_id', 'session_id'],
      indexes: [{ columns: ['session_id'] }],
    }),
  },
  entityViews: [
    { table: 'boxxy_item', kind: 'boxxy:item', id: 'id', title: 'title', url: null, actor: null, updatedAt: 'updated_at' },
    { table: 'boxxy_attempt', kind: 'boxxy:attempt', id: 'id', title: 'phase', url: null, actor: null, updatedAt: 'updated_at' },
  ],
  // a scope consumer reads no row: the build and the host both refuse a non-empty list here
  reads: [],
  links: [ranIn, produced, attemptOf],
});

// definePlugin works out the link types from the consumers' `links`, and the entity kinds from the
// families and the entity views.
// The two queries are not repeated here. `boxxy_cost_to_land` (it reads
// `telemetry_model_request` and `telemetry_turn_cost`, and returns lines per phase, rework,
// product and model) and `boxxy_stage_time` are in the boxxy repo's sketch of the package.
export const boxxyPlugin = definePlugin({
  name: 'boxxy',
  sources: [boxxySource],
  consumers: [boxxyWorkConsumer],
  queries: [/* boxxyCostToLandQuery, boxxyStageTimeQuery */],
});

// The same package also sends: boxxy repo, the fact sink.
import { createFactBatchSender } from '@pepys/kit/send';

const sendFacts = createFactBatchSender({
  source: boxxySource,
  url: 'https://ingest.pepys.example/boxxy/facts',
  secret: process.env['BOXXY_PEPYS_SIGNING_SECRET'] ?? '',
});

// boxxy's item and attempt IDs are UUID version 7 strings. The fact ID is `event:boxxy:<event>`.
// A repeat of this call may put a second copy in the log; each consumer drops the copy by its
// fact ID.
const sent = await sendFacts([
  {
    type: 'boxxy.attempt.started',
    event: '0193a1b2-0000-7000-8000-0000000000e1',
    entity: 'boxxy:item:0193a1b2-0000-7000-8000-000000000001',
    at: '2026-11-11T02:14:07.000Z',
    payload: { attempt: '0193a1b2-0000-7000-8000-0000000000a1', atcSession: 's-9' },
  },
]);

if (!sent.ok) {
  // `retry` is EVERY 5xx answer (500 and 503 alike), a timeout, or no connection: send
  // the same batch again, unchanged. `refused` is a 4xx answer: the batch itself is wrong.
  console.error(sent.failure);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Place 2 (invented): boxxy repo, packages/pepys/src/consumers/boxxy-work.ts, ABRIDGED
// The scriptc entry file. It imports the generated glue only (file 3, part C shows the glue).
// Two branches of the real file; the whole is in the boxxy repo's sketch of the package.
// ─────────────────────────────────────────────────────────────────────────────────────────────
import { linkProduced, linkRanIn, readScopeFacts, toBoxxyAttemptID, toBoxxyItemID, toGithubPullRequestID, toTelemetrySessionID } from '../generated/boxxy-work-boundary.ts';
import type { BoxxyWorkOperation } from '../generated/boxxy-work-boundary.ts';

// The host calls this export with one item's ID each time a fact for that item arrives. The result
// is the whole set of rows and links the scope owns: what it leaves out, the host removes.
export function applyScope(scope: string): string {
  const item = toBoxxyItemID(scope);
  const operations: BoxxyWorkOperation[] = [];

  // every fact of this item, one per fact ID, sorted by source time, then stream, then sequence
  for (const fact of readScopeFacts(item)) {
    if (fact.type === 'boxxy.attempt.session_bound') {
      const attempt = toBoxxyAttemptID(fact.payload.attempt);
      const session = toTelemetrySessionID(fact.payload.atcSession);

      operations.push({ upsert: { boxxy_attempt_session: { attempt_id: attempt, session_id: session, key: 'atc', product: null, bound_at: fact.at } } });
      operations.push(linkRanIn({ from: attempt, to: session, confidence: 1, evidence: fact.id }));
    }

    if (fact.type === 'boxxy.pull_request.linked') {
      // the pull request need not have arrived: the host looks no row up
      operations.push(
        linkProduced({
          from: toBoxxyAttemptID(fact.payload.attempt),
          to: toGithubPullRequestID(fact.payload.pullRequestId),
          confidence: 1,
          evidence: fact.id,
        }),
      );
    }

    // …the item row, the attempt rows and `attempt_of`: the real file
  }

  return JSON.stringify(operations);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Place 3 (invented): boxxy repo, a test of the consumer, with `bun test` and nothing else.
// Shortened. The tests of the two queries are in the boxxy repo's sketch of the package.
// ─────────────────────────────────────────────────────────────────────────────────────────────
import { expect, test } from 'bun:test';
// The test store is a package of its own, a dev dependency.
import { createTestStore } from '@pepys/testing';
import { githubPlugin, telemetryPlugin } from './05-telemetry-github.ts';
import type { telemetryModelRequestConsumer } from './05-telemetry-github.ts';

// boxxy's test helper: it fills every payload field the test does not give, with a valid value.
declare function fact<Type extends string>(type: Type, at: string, payload: Readonly<Record<string, unknown>>): OutgoingFact<typeof boxxySource>;

test('it writes one session row and one link for a session that two facts name', async () => {
  // The other two plug-ins are here because boxxy's links name kinds that they own.
  await using store = await createTestStore({ plugins: [boxxyPlugin, telemetryPlugin, githubPlugin] });

  const attempt = '0193a1b2-0000-7000-8000-0000000000a1';
  const bound = fact('boxxy.attempt.session_bound', '2026-11-11T02:15:00.000Z', { attempt, atcSession: 's-9', agentSession: 'c-1', product: 'claude_code' });

  // `bound` goes in twice, as a repeated batch would
  await store.apply(boxxySource, [
    fact('boxxy.item.filed', '2026-11-11T02:00:00.000Z', { title: 'Chart the shoals' }),
    fact('boxxy.attempt.claimed', '2026-11-11T02:01:00.000Z', { attempt, phase: 'build', number: 1, round: 1 }),
    fact('boxxy.attempt.started', '2026-11-11T02:14:07.000Z', { attempt, atcSession: 's-9' }),
    bound,
    bound,
  ]);

  expect(await store.readLinks()).toMatchObject([
    { type: 'attempt_of', from_id: 'boxxy:attempt:0193a1b2-0000-7000-8000-0000000000a1', to_id: 'boxxy:item:0193a1b2-0000-7000-8000-000000000001', origin: 'boxxy_work', scope: 'boxxy:item:0193a1b2-0000-7000-8000-000000000001' },
    { type: 'ran_in', from_id: 'boxxy:attempt:0193a1b2-0000-7000-8000-0000000000a1', to_id: 'telemetry:session:c-1' },
    { type: 'ran_in', from_id: 'boxxy:attempt:0193a1b2-0000-7000-8000-0000000000a1', to_id: 'telemetry:session:s-9' },
  ]);
});

// A row of `telemetry_model_request` that a test seeds has the columns of file 5:
//   await store.seed(telemetryModelRequestConsumer, 'telemetry_model_request', [{ id: 'telemetry:model_request:claude_code.api_request:req_01',
//     session_id: 'telemetry:session:s-9', agent_session: 'c-1', product: 'claude_code', model: 'model-large', input_tokens: 12,
//     cache_read_tokens: 900, cache_creation_tokens: 30, output_tokens: 210, cost_usd: 0.4, cost_basis: 'reported', duration_ms: 4100,
//     agent: null, at: '2026-11-11T02:20:00Z' }]);
declare const seeded: typeof telemetryModelRequestConsumer;
void seeded;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Place 4 (invented): deployment repo
// ─────────────────────────────────────────────────────────────────────────────────────────────

// src/deployment.ts — the one definition. It reads no environment and no secret.
import type { DeploymentClient } from './04-store-api.ts';
import { defineDeployment, listReceiveRoutes } from '@pepys/kit';

export const deployment = defineDeployment({ name: 'harbour', plugins: [githubPlugin, telemetryPlugin, boxxyPlugin] });
// A deployment with another deploy tag adds
//   settings: { github: { deployTagPattern: 'shipped/<environment>' } }

export type HarbourClient = DeploymentClient<typeof deployment>;

// A package that holds a plug-in types its own calls with no deployment in reach:
//   const client: PluginClient<typeof boxxyPlugin> = createORPCClient(link);
//   await client.boxxy_stage_time({ item: 'boxxy:item:…', environment: 'production' });

// src/ingest.ts:  await serveIngest({ deployment, environment: process.env });     (file 2)
// src/api.ts:     await serveAPI({ deployment, environment: process.env });        (file 4)

// The deployment repo's infrastructure code reads the route table from the same definition, and
// makes a public rule for exactly the routes marked `public`:
const routes = listReceiveRoutes(deployment);
// [ { source: 'github',    route: '/webhook',           check: 'hmac-sha256', reach: 'public'  },
//   { source: 'telemetry', route: '/v1/logs',           check: 'token',       reach: 'private' },
//   { source: 'boxxy',     route: '/boxxy/facts',       check: 'hmac-sha256', reach: 'private' } ]

// package.json:  "consumers:build": "pepys build src/deployment.ts --out build/consumers"
// The image copies build/consumers beside the Rust host binary. The host's entry command:
//   pepys-host run --up --consumers /modules/consumers.json          (file 3, part F)

void [routes];

// ═════════════════════════════════════════════════════════════════════════════════════════════
// The types. pepys repo, packages/kit/src/index.ts (new package `@pepys/kit`).
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Packages:
//   @pepys/kit               every declaration, the checks, the generators (this file)
//   @pepys/kit/send          the client that signs and sends a fact batch
//   @pepys/testing           the test store and the memory store reader (new package)
//   @pepys/ingest            serveIngest                                    (file 2)
//   @pepys/api               serveAPI, DeploymentClient                     (file 4)
//   @pepys/cli               the `pepys` binary (Bun): `pepys build`
//   @pepys/source-github, @pepys/source-telemetry                           (file 5)
//   @pepys/schema            the consumer manifest types and their case file (file 3)
//   @pepys/contract, @pepys/kysely-turso
//
// @pepys/kit depends on zod, and on kysely as an optional peer dependency for its types only. It does not depend on
// @pepys/kysely-turso, so a process that only declares or sends (ingest, the boxxy server) installs
// no SQLite binding. The SQL schema generator and the glue generator stay in the kit
// (packages/kit/src/generators, exported as `@pepys/kit/generators`): they write text and open no
// database. @pepys/cli and @pepys/testing both call them.

import type { Kysely } from 'kysely';
import type { ConsumersDB, StoreReader } from './04-store-api.ts';

// Moved to the kit from packages/schema, with no other change: FactEnvelope, Result,
// TableDeclaration, TableRow, defineTable, and the ID types.
//
// parseFactEnvelope moves to the kit AND gains a fact ID form. In the repo today
// (packages/kit/src/facts/parse-fact-envelope.ts) `factIDPattern` accepts two forms:
//   ^webhook:[a-z][a-z0-9_]*:.+$
//   ^(?:observation|enrichment|manual):[0-9a-f]{64}$
// It gains a third, for a pushed fact, with the shape of the webhook form:
//   ^event:[a-z][a-z0-9_]*:.+$
// The middle part is the source's name. The rest is the sender's event ID: one character or
// more, on one line (`.` matches no line end). It may hold `:` and `.`, so both of v1's forms
// pass: `event:boxxy:evt-0193` and `event:telemetry:claude_code.api_request:req_01`.
// What changes with the pattern, in the same change:
//   - fact-envelope-cases.json (it moves to packages/kit/src with the parser) gains five cases:
//       accepts  "event:boxxy:evt-0001"
//       accepts  "event:telemetry:claude_code.api_request:req_01"
//       accepts  "event:telemetry:codex.sse_event:h-5e1c…" (a hash key)
//       refuses  "event:boxxy:"            (no event ID)
//       refuses  "event:Boxxy:evt-0001"    (a source name that is not lower snake case)
//     and its existing cases change `github:pr:77` to `github:pull_request:77`.
//   - the Rust host's envelope check, crates/host/src/fact_log/envelope.rs: `FACT_KINDS` gains
//     "event", and `is_fact_id` takes `event:` through the branch that `webhook:` takes today
//     (a source name, a colon, a rest that is not empty). Its test
//     `it_gives_each_shared_envelope_case_its_verdict` reads the same case file.
//   - the TypeScript list of fact kinds, packages/schema/src/entity-ids/fact-kinds.ts
//     (`factKinds`; it moves to the kit with the ID parsers), gains 'event' in the SAME change.
//     Both lists have a second use: an ENTITY ID whose source is a fact kind is refused
//     (`is_entity_id` in Rust, `parseEntityID` in TypeScript), so a fact ID never parses as an
//     entity ID. With 'event' in the Rust list alone, ingest would store an envelope with the
//     entity `event:x:y` and the host would refuse it.
//     The case file gains three more cases, for the entity side:
//       refuses  an envelope whose `entity` is "event:x:y"
//       refuses  an envelope whose `actor` is "event:boxxy:evt-0001"   (a fact ID in an entity field)
//       accepts  an envelope whose `entity` is "events:x:y"            (only the exact kind is refused)
//     The case file has cases for both uses of the list, and each language's test reads it. A
//     use of the list that no case covers can still part.
//     One effect: no source may be named `event`, as none may be named `webhook` today.
//     `checkDeployment` refuses a source whose name is a fact kind (`reserved-source-name`).
//   - log.md's fact ID table gains the row "source history event".
// Without this, ingest's envelope check answers 422 to every boxxy batch and every telemetry
// export. The test that proves the route end to end is in file 2, "Usage".
// A declaration names a stream with the template type; `StreamName` stays branded, for a name a
// parser checked. The sketch writes `StreamName` in declarations; read it as `DeclaredStreamName`.
declare type DeclaredStreamName = `facts.${string}.${string}`;
declare type StreamName = DeclaredStreamName;
declare type EntityID = string;
declare type FactID = string;
declare type BlobHash = string;
declare type Result<Value, Failure> = { ok: true; value: Value } | { ok: false; failure: Failure };
declare interface FactEnvelope<Payload> { id: FactID; type: string; v: 1; api: string; entity: EntityID; actor?: EntityID; at: string; payload: Payload }
declare interface TableDeclaration { columns: Readonly<Record<string, { kind: ColumnKind; nullable?: boolean }>>; primaryKey: readonly string[]; indexes: readonly { columns: readonly string[] }[] }
declare type TableRow<Table extends TableDeclaration> = { [Column in keyof Table['columns']]: unknown };
export type ColumnKind = 'text' | 'integer' | 'real' | 'boolean' | 'json' | 'entityID' | 'timestamp';
export type { EntityID, FactEnvelope, FactID, Result, StreamName, TableDeclaration, TableRow };

// ── A. Entity kinds and link types ─────────────────────────────────────────────────────────────

// One form everywhere: `<source>:<kind>`. A pull request is `github:pull_request` in the entity
// view, in link ends and in the entity ID `github:pull_request:<id>`.
export type EntityKind = `${string}:${string}`;

export interface LinkTypeDeclaration<Name extends string = string, From extends EntityKind = EntityKind, To extends EntityKind = EntityKind> {
  readonly name: Name;
  readonly from: readonly From[];
  readonly to: readonly To[];
  // a hub type is not followed by `neighbourhood` unless the caller asks
  readonly hub: boolean;
}

export declare function defineLinkType<const Name extends string, const From extends EntityKind, const To extends EntityKind>(
  linkType: LinkTypeDeclaration<Name, From, To>,
): LinkTypeDeclaration<Name, From, To>;

// ── B. Fact families ───────────────────────────────────────────────────────────────────────────

export interface FactFamily<Types extends Readonly<Record<string, z.ZodType>> = Readonly<Record<string, z.ZodType>>, Kind extends EntityKind = EntityKind> {
  readonly stream: StreamName;
  readonly api: string;
  // the kind that the `entity` of every fact of the family has
  readonly entityKind: Kind;
  // one zod schema per fact type; a fact type name belongs to one family of a source
  readonly types: Types;
}

export declare function defineFactFamily<const Types extends Readonly<Record<string, z.ZodType>>, const Kind extends EntityKind>(
  family: FactFamily<Types, Kind>,
): FactFamily<Types, Kind>;

// ── C. Sources ─────────────────────────────────────────────────────────────────────────────────

// Plain data and functions. A source holds no secret and reads no environment.
export interface SourceDefinition<Family extends FactFamily = FactFamily> {
  readonly name: string;
  readonly families: readonly Family[];
  readonly live?: ReceivePath | PullPath;
  readonly recovery?: PullPath;
  readonly backfill?: PullPath;
  readonly resync?: PullPath;
}

export declare function defineSource<const Family extends FactFamily>(source: SourceDefinition<Family>): SourceDefinition<Family>;

// Ingest owns everything before and after `read`: the method, the size, the check, the decoding,
// the fact limit, the appends and the answer (file 2 has the order).
export interface ReceivePath {
  readonly kind: 'receive';
  readonly route: string;
  // More routes that pass the same check and sender, answer as an ignored delivery, and store
  // nothing: an OTLP exporter sends metrics and traces beside its logs, and retries a refusal.
  // `listReceiveRoutes` lists each with `stores: false`, and `checkDeployment` refuses a route
  // that clashes with any other route.
  readonly ignoredRoutes?: readonly string[];
  readonly check: DeliveryCheck;
  // Default 1 MiB. It bounds the body as sent AND the body after decoding.
  readonly bodyByteLimit?: number;
  // Default 100. Ingest answers 413 to a batch with more facts. Ingest splits one
  // stream's facts into as many appends as the log's limits need (file 2, part 3).
  readonly factLimit?: number;
  // The `content-encoding` values the path takes besides none. Default []. The check
  // runs on the bytes as sent; `read` gets the decoded bytes.
  readonly encodings?: readonly 'gzip'[];
  // What a success answers.
  //   'status' (default)  200 {"status":"stored","stored":<n>}; 202 {"status":"ignored"}
  //   'empty'             200 {} for stored and for ignored (what an OTLP exporter expects)
  // Every failure answer is the same for both.
  readonly answer?: 'status' | 'empty';
  // Who must reach the route. Default 'private': the deployment's own network.
  // 'public': the public internet. Ingest cannot tell where a request came from, so this is a
  // mark for `listReceiveRoutes`, which the deployment's network rules read. It changes no answer.
  readonly reach?: 'public' | 'private';
  // A path that needs a proven sender. Ingest then
  // calls its `SenderProof` port (below) beside the path's `check`, and gives `read` the result
  // as `Delivery.sender`. No proof: 401, nothing stored. The path names the proof as data, as
  // it names its `check`: `kind` picks the adapter, `issuersEnv` names the folder of trust
  // documents.
  readonly sender?: SenderRequirement;
  // Pure: it writes nothing. `source` is the source this path is in.
  readonly read: (delivery: Delivery, source: SourceContext) => Received;
}

// The check as data. Ingest reads the secret from the variable `secretEnv` at start.
// Neither kind signs a timestamp, so a source's fact IDs must come from the signed body alone,
// never from a header. Then a replay is a copy that every consumer drops (02-ingest-log.ts, "A
// replayed delivery").
// `hmac-sha256`: the header holds `sha256=<hex of HMAC-SHA256(secret, body as sent)>`, the scheme
// GitHub uses. `token`: the header holds the secret, or `Bearer <secret>`, for a sender that cannot
// sign a body.
export interface DeliveryCheck {
  readonly kind: 'hmac-sha256' | 'token';
  readonly header: string;
  readonly secretEnv: string;
}

export interface SenderRequirement { readonly kind: 'imp-identity'; readonly audience: string; readonly issuersEnv: string }

export interface Delivery {
  headers: Headers;
  body: Uint8Array; // after the check passed, and after decoding
  // The proven sender of the delivery; present on
  // every call of `read` for a path that has `sender`. `read` never takes a sender from
  // `headers` itself.
  sender?: Sender;
}

// pepys's own words for a proven sender, and the port that ingest calls.
// The name follows the kit's other ports (`FactLog`, `BlobStore`): a noun, no `Port` suffix.
// Adapters, in packages/ingest/src/sender: `impIdentitySenderProof` (it verifies the signed token
// in the `Imp-Identity` header: `issuer` is the token's `iss`, `subject` is its
// `sub`), `createFakeSenderProof` for tests, and `noSenderProof` (always null), which ingest
// uses for a path whose trust documents are missing, so that the path refuses every delivery.
export interface Sender { readonly issuer: string; readonly subject: string; readonly name: string }
export interface SenderProof {
  prove: (requirement: SenderRequirement, headers: Headers) => Promise<Sender | null>;
}

export interface SourceContext {
  name: string;
  families: readonly FactFamily[];
}

// 401, 405, 413 and 415 are ingest's answers, so `read` refuses with 400 or 422 only.
export type Received =
  | { kind: 'refused'; status: 400 | 422; reason: string }
  | { kind: 'ignored' }
  | { kind: 'batch'; batch: Batch };

// A pull path names the variables it needs; ingest reads them at start and passes the values.
export interface PullPath {
  readonly kind: 'pull';
  readonly name: string;
  readonly intervalMs: number | null;
  readonly env?: readonly string[];
  readonly pull: (cursor: string | null, context: { env: Readonly<Record<string, string>> }) => Promise<Pulled>;
}

export type Pulled =
  | { kind: 'batch'; batch: Batch; cursor: string; isDone: boolean }
  | { kind: 'expired' }
  | { kind: 'unavailable'; retryAfterMs: number }
  | { kind: 'rejected'; reason: string };

export interface Batch {
  facts: readonly PendingFact[];
}

export interface PendingFact {
  stream: StreamName;
  fact: FactEnvelope<unknown>;
  blobs: readonly { hash: BlobHash; bytes: Uint8Array }[];
}

// The receive path of a fact batch. Its `read` parses FactBatchBody against the source's families
// and builds each fact ID as `event:<source>:<event>`.
export declare function receiveFactBatch(
  receiver: Pick<ReceivePath, 'route' | 'check' | 'bodyByteLimit' | 'factLimit' | 'reach' | 'sender'>,
): ReceivePath;

export interface FactBatchBody {
  v: 1;
  facts: readonly { type: string; event: string; entity: EntityID; actor?: EntityID | undefined; at: string; payload: unknown }[];
}

export declare function buildEventFactID(parts: { source: string; event: string }): FactID;

// The route table of a deployment. Pure. Ingest mounts from it and logs it at
// start; the deployment's infrastructure code reads it for its network rules.
export interface ReceiveRoute {
  source: string;
  route: string;
  check: DeliveryCheck['kind'];
  reach: 'public' | 'private';
  // false for a route in `ignoredRoutes`
  stores: boolean;
}

export declare function listReceiveRoutes(deployment: Deployment): readonly ReceiveRoute[];

// ── D. @pepys/kit/send ─────────────────────────────────────────────────────────────────────────

export type OutgoingFact<Source extends SourceDefinition> = {
  [Family in Source['families'][number] as Family['stream']]: {
    [Type in keyof Family['types'] & string]: {
      type: Type;
      event: string;
      entity: `${Family['entityKind']}:${string}`;
      actor?: string;
      at: string;
      payload: z.input<Family['types'][Type]>;
    };
  }[keyof Family['types'] & string];
}[Source['families'][number]['stream']];

// Every 5xx is `retry`, not only 503. Ingest answers 500 when the log refuses an
// append for a fault of the deployment, and part of the batch may be stored by then. A sender
// that dropped the batch as `refused` would lose the rest.
export type SendFailure = { kind: 'refused'; status: number; reason: string } | { kind: 'retry'; reason: string };

// Signs as the `check` of the source's live path says. It refuses, before any request, a list
// longer than the path's `factLimit`.
export declare function createFactBatchSender<Source extends SourceDefinition>(options: {
  source: Source;
  url: string;
  secret: string;
  // Defaults to the global `fetch`. The route test in file 2 passes ingest's own handler.
  fetch?: (request: Request) => Promise<Response>;
}): (facts: readonly OutgoingFact<Source>[]) => Promise<Result<{ stored: number }, SendFailure>>;

// ── E. Consumers ───────────────────────────────────────────────────────────────────────────────

// One type for the declaration's `input` and the manifest's `input` (file 3). The
// tag is `mode`, and both modes hold `streams`, a list. The build copies the object and maps
// nothing. The repo's type of the same name in consumer-execution/types.ts (the input of one
// call: FactInput | ScopeInput) is renamed ConsumerCallInput.
export type ConsumerInput =
  | { readonly mode: 'fact'; readonly streams: readonly StreamName[] }
  // A fact on one of `streams` whose entity is of `scopeKind` marks that entity's scope dirty.
  | { readonly mode: 'scope'; readonly scopeKind: EntityKind; readonly streams: readonly StreamName[] };

export interface EntityViewDeclaration<TableName extends string = string> {
  readonly table: TableName;
  readonly kind: EntityKind;
  readonly id: string;
  readonly title: string;
  readonly url: string | null;
  readonly actor: string | null;
  readonly updatedAt: string;
}

export interface ConsumerDeclaration<
  Name extends string = string,
  Tables extends Readonly<Record<string, TableDeclaration>> = Readonly<Record<string, TableDeclaration>>,
  LinkType extends LinkTypeDeclaration = LinkTypeDeclaration,
> {
  readonly name: Name;
  // The scriptc entry file: a library that exports a model type, a message type, `init` and
  // `update` beside the consumer. scriptc attests no other shape.
  readonly entry: URL;
  readonly input: ConsumerInput;
  readonly tables: Tables;
  // One view per table whose rows are entities. The schema generator writes the file's `entity`
  // view as a `union all` of them. Typed wide here, so a declaration fits the wide consumer type;
  // `defineConsumer` keeps the table names of `entityViews` and `reads` to the consumer's own.
  readonly entityViews: readonly EntityViewDeclaration[];
  // Own tables whose rows the module reads by key. Fact mode only: empty in scope mode.
  readonly reads: readonly string[];
  // the link types the consumer may write; the manifest holds them whole
  readonly links: readonly LinkType[];
}

export declare function defineConsumer<
  const Name extends string,
  const Tables extends Readonly<Record<string, TableDeclaration>>,
  const LinkType extends LinkTypeDeclaration,
>(consumer: ConsumerDeclaration<Name, Tables, LinkType>): ConsumerDeclaration<Name, Tables, LinkType>;

// ── F. Queries ─────────────────────────────────────────────────────────────────────────────────

type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (value: infer Intersection) => void ? Intersection : never;

// The Kysely tables of a set of consumers, from their declarations.
export type StoreTables<Consumers extends readonly ConsumerDeclaration[]> = UnionToIntersection<
  { [Name in keyof Consumers[number]['tables']]: TableRow<Consumers[number]['tables'][Name]> }
>;

export interface QueryCall<Input, Consumers extends readonly ConsumerDeclaration[]> {
  input: Input;
  // One read-only connection with the current file of each consumer in `reads` attached, plus the
  // `entity` and `link_effective` views over those files (ConsumersDB: file 4).
  db: Kysely<ConsumersDB<Consumers>>;
}

// Generic over the schemas: `z.ZodType<Input>` keeps the parsed type alone, and a client needs the
// type a schema takes in.
export interface QueryDefinition<Name extends string = string, InputSchema extends z.ZodType = z.ZodType, OutputSchema extends z.ZodType = z.ZodType, Consumers extends readonly ConsumerDeclaration[] = readonly ConsumerDeclaration[]> {
  // snake case: the oRPC procedure key and the MCP tool name
  readonly name: Name;
  // the text an MCP agent reads; it becomes `oc.meta(openapi({ description }))` (file 4)
  readonly description: string;
  // Plain zod objects with no `.transform`: the MCP input and output schemas come from them.
  readonly input: InputSchema;
  readonly output: OutputSchema;
  readonly reads: Consumers;
  readonly handler: (call: QueryCall<z.output<InputSchema>, Consumers>) => Promise<z.input<OutputSchema>>;
}

// Any query, as a plug-in's list holds it. Each handler takes its own call type, so the list's
// handler takes `never`.
export type AnyQueryDefinition = Omit<QueryDefinition, 'handler'> & { readonly handler: (call: never) => Promise<unknown> };

export declare function defineQuery<const Name extends string, InputSchema extends z.ZodType, OutputSchema extends z.ZodType, const Consumers extends readonly ConsumerDeclaration[]>(
  query: QueryDefinition<Name, InputSchema, OutputSchema, Consumers>,
): QueryDefinition<Name, InputSchema, OutputSchema, Consumers>;

// ── G. Plug-ins and deployments ────────────────────────────────────────────────────────────────

export interface Plugin<Query extends AnyQueryDefinition = AnyQueryDefinition> {
  // the kit version the plug-in was declared with; `checkDeployment` refuses another
  readonly kit: number;
  // the plug-in's compile-time settings, or undefined when it has none
  readonly settings: PluginSettings | undefined;
  readonly name: string;
  readonly sources: readonly SourceDefinition[];
  readonly consumers: readonly ConsumerDeclaration[];
  readonly queries: readonly Query[];
  readonly linkTypes: readonly LinkTypeDeclaration[]; // derived: every consumer's `links`, once per name
  readonly entityKinds: readonly EntityKind[]; // derived: every family's `entityKind`, every entity view's `kind`
}

// Compile-time settings of a plug-in.
//   - The plug-in declares a zod `schema` (a flat object of strings, numbers and booleans) and
//     the `defaults`.
//   - The deployment file gives the values (`Deployment.settings`, by plug-in name). A value
//     that is left out takes its default.
//   - `checkDeployment` parses the values against the schema, and fails with `invalid-settings`.
//   - `pepys build` bakes the checked values into the generated glue of each consumer of the
//     plug-in, as constants: `export const settings = { … } as const`. The consumer imports them.
//   - Nothing is read at run time, so the consumer stays deterministic. The values are in the
//     module's bytes, so a settings change is a new consumer version.
export interface PluginSettings<Schema extends z.ZodObject = z.ZodObject> {
  readonly schema: Schema;
  readonly defaults: z.output<Schema>;
}

export declare function definePlugin<const Query extends AnyQueryDefinition = never>(plugin: {
  readonly name: string;
  readonly sources?: readonly SourceDefinition[];
  readonly consumers?: readonly ConsumerDeclaration[];
  readonly queries?: readonly Query[];
  readonly settings?: PluginSettings;
}): Plugin<Query>;

export interface Deployment<Plugins extends readonly Plugin[] = readonly Plugin[]> {
  readonly name: string;
  readonly plugins: Plugins;
  // The settings values, by plug-in name. Literals only: the deployment
  // file reads no environment. Absent: every plug-in runs with its defaults.
  readonly settings?: Readonly<Record<string, Readonly<Record<string, string | number | boolean>>>>;
}

export declare function defineDeployment<const Plugins extends readonly Plugin[]>(deployment: Deployment<Plugins>): Deployment<Plugins>;

// The typed client of ONE plug-in's queries, by name. A type only: the kit gains no
// run-time code and no oRPC dependency for it. The package that holds the plug-in (such as the
// boxxy pepys package's reader) types its RPC client with it, and needs neither the deployment
// file, which lives in another repo, nor @pepys/api. `DeploymentClient` (file 4) is the core
// procedures plus this type for each plug-in of the deployment.
export type PluginClient<Target extends Plugin> = {
  [Query in Target['queries'][number] as Query['name']]: (input: z.input<Query['input']>) => Promise<z.output<Query['output']>>;
};

// What each process and the build work from. `linkTypes` and `entityKinds` stay here, for the API
// and the test store. They are NOT written to consumers.json (file 3).
export interface CheckedDeployment {
  readonly name: string;
  readonly sources: readonly SourceDefinition[];
  readonly consumers: readonly ConsumerDeclaration[];
  readonly queries: readonly AnyQueryDefinition[];
  readonly entityKinds: readonly EntityKind[];
  readonly linkTypes: readonly LinkTypeDeclaration[];
  // the checked settings of each plug-in that declares some, defaults filled in
  readonly settings: Readonly<Record<string, Readonly<Record<string, string | number | boolean>>>>;
}

export type DeploymentFailure =
  | { kind: 'kit-version'; plugin: string; kit: number }
  // `entity-view-kind`: two entity views of one kind, so a kind has one owning table
  | { kind: 'duplicate'; of: 'plugin' | 'source' | 'stream' | 'route' | 'fact-type' | 'consumer' | 'table' | 'query' | 'link-type' | 'entity-view-kind'; name: string; plugins: readonly string[] }
  // a link end or a `scopeKind` names a kind that no plug-in in the deployment brings
  | { kind: 'unknown-entity-kind'; entityKind: EntityKind; plugin: string; usedBy: string }
  | { kind: 'missing-consumer'; consumer: string; query: string }
  | { kind: 'missing-stream'; stream: StreamName; consumer: string }
  // `get_entity` and `neighbourhood` are the core's
  | { kind: 'reserved-query-name'; query: string }
  // the host's own names in every consumer file: link, link_effective, entity, offsets,
  // change_log, applied_facts, scope_row
  | { kind: 'reserved-table-name'; table: string; consumer: string }
  // an entity view or a `reads` entry that names no table of the consumer
  | { kind: 'unknown-table'; consumer: string; table: string; usedBy: 'reads' | 'entity-view' }
  // a primary key, an index or an entity view that names a column its table does not declare
  | { kind: 'unknown-column'; consumer: string; table: string; column: string; usedBy: 'primary-key' | 'index' | 'entity-view' }
  // a scope consumer with a non-empty `reads`
  | { kind: 'scope-reads'; consumer: string }
  // a source named as a fact kind is: webhook, event, observation, enrichment, manual
  | { kind: 'reserved-source-name'; source: string }
  // a value that fails the plug-in's settings schema, or settings for a
  // plug-in that declares none or is not in the deployment
  | { kind: 'invalid-settings'; plugin: string; issues: readonly string[] };

// Ingest, the API, the build and the test store each call this first, and stop on a failure.
export declare function checkDeployment(deployment: Deployment): Result<CheckedDeployment, readonly DeploymentFailure[]>;

// ── H. @pepys/testing, `pepys build`, and the import check ─────────────────────────────────────

// @pepys/testing (new package; packages/testing). It depends on @pepys/kit and @pepys/kysely-turso.
// What it runs: the consumer's TypeScript entry on Bun; one in-memory SQLite database with every
// table, the host's `link` table and the two views; the query's handler on Kysely. It drops a fact
// by fact ID before a consumer sees it, and repeats the host's link check and replace-a-scope rule
// in TypeScript. It does not prove: the scriptc compile, that the module equals the TypeScript
// run, the Rust host, one file per consumer, the route. `pepys build` and the pepys e2e lane do.
// `apply` calls the same parseFactEnvelope as the route, so a fact ID that the parser
// refuses fails here too. It still skips the route itself; the route test in file 2 covers that.
export interface TestStore extends AsyncDisposable {
  seed: <Consumer extends ConsumerDeclaration, Table extends keyof Consumer['tables'] & string>(
    consumer: Consumer,
    table: Table,
    rows: readonly TableRow<Consumer['tables'][Table]>[],
  ) => Promise<void>;
  // Builds the envelopes as `receiveFactBatch` does (`event:` IDs) and runs each consumer whose
  // input names the fact's stream. A source whose fact IDs are not `event:` IDs (GitHub: a hash
  // of the body) cannot use it; its consumers test on
  // operations, and its queries on `seed`.
  apply: <Source extends SourceDefinition>(source: Source, facts: readonly OutgoingFact<Source>[]) => Promise<void>;
  query: <InputSchema extends z.ZodType, OutputSchema extends z.ZodType>(query: QueryDefinition<string, InputSchema, OutputSchema>, input: z.input<InputSchema>) => Promise<z.output<OutputSchema>>;
  readLinks: () => Promise<readonly import('./04-store-api.ts').LinkRow[]>;
  readRows: (table: string) => Promise<readonly Readonly<Record<string, unknown>>[]>;
  // the memory adapter of the StoreReader port, for a test of a core query
  reader: StoreReader;
}

export declare function createTestStore(options: { plugins: readonly Plugin[] }): Promise<TestStore>;

// packages/cli — `pepys` is the Bun CLI; the Rust host binary is `pepys-host`.
//
//   pepys build <file> --out <directory> [--check]
//
// <file> exports a Deployment or a Plugin. In this order:
//   1. checkDeployment (for a Plugin: the checks that need no other plug-in).
//   2. Glue, for every consumer, before any compile: <consumer>-boundary.ts and <consumer>.sql.
//      The glue of a consumer whose plug-in has settings also exports the
//      checked values as `settings`, a constant. A plug-in built alone gets its defaults.
//      A consumer of the package the command runs in: write them into <dirname(entry)>/../generated/;
//      the package commits and publishes them.
//      A consumer of a dependency: copy that package's `src` folder to
//      <directory>/.work/<package>/src, write the glue there with THIS cli's generator, and compile
//      from there. The published glue is never compared. An entry that does not fit the new glue
//      fails in step 3 with scriptc's type error, which names the line.
//   3. Compile each entry with scriptc as a fenced library. Fail unless scriptc attests the module
//      deterministic and it imports nothing forbidden.
//   4. Write <directory>/<consumer>/<module hash>.wasm and <directory>/consumers.json (file 3).
// With no zig or wasm-tools: step 2 finishes, then exit 1 with the name of the missing tool.
// --check writes nothing and exits 1 when a glue file of the package itself is stale.
// The generated glue reads the facts with an index loop, never `for...of` over the untyped parse
// result and never `.filter` (`for...of` there makes scriptc link `scr_dyn_invoke.o`).
//
// The import check: an oxlint `no-restricted-imports`
// allow-list on packages/{kit,schema,contract,ingest,api,cli,testing,kysely-turso}/**. A core
// package imports the named core packages and no other `@pepys/*` package.
