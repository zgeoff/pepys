// pepys v1, file 4 of 5: the store reader, the link tables as a query sees them, the two core
// queries, and the API on oRPC v2 with MCP. Usage first, then types, then flow. Not compiled.
//
// Home file of: StoreReader, AttachedCall, SharedViews, LinkRow, HostTables, ConsumersDB,
// LinkRegistry, LinkProblem, findLinkProblem, EntityKindIndex, the core contract, serveAPI,
// DeploymentClient.

import type { Kysely } from 'kysely';
import type { z } from 'zod';
import type { CheckedDeployment, ConsumerDeclaration, Deployment, EntityKind, EntityViewDeclaration, LinkTypeDeclaration, PluginClient, QueryDefinition, Result, StoreTables } from './01-kit.ts';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Usage
// ═════════════════════════════════════════════════════════════════════════════════════════════

// deployment repo, src/api.ts — the API process. serveAPI reads PEPYS_STORE_DIR, PEPYS_API_PORT
// (default 8081) and PEPYS_API_HOST. The host setting is new. Its default is 127.0.0.1,
// which is what serve.ts has as a constant today; a deployment behind a Service sets 0.0.0.0.
// v1 has no token check, so the listen address and the network rules are all that guard the API.
declare const deployment: Deployment;
await serveAPI({ deployment, environment: process.env });

// A typed caller. The client type comes from the deployment definition.
declare const client: DeploymentClient<Deployment>;

// boxxy's IDs are UUID version 7 strings, shortened here as `…a1` (an attempt) and
// `…01` (an item). The title of an attempt is its phase. `outcome` is a name of the phase kind's
// list, such as `built`; no boxxy row says "landed".
const found = await client.get_entity({ id: 'boxxy:attempt:0193a1b2-0000-7000-8000-0000000000a1' });
// { entity: { id: 'boxxy:attempt:…a1', kind: 'boxxy:attempt', title: 'build', url: null,
//             actor: null, updated_at: '2026-11-03T04:10:00.000Z' },
//   consumer: 'boxxy_work', table: 'boxxy_attempt',
//   row: { id: 'boxxy:attempt:…a1', item_id: 'boxxy:item:…01', phase: 'build', state: 'succeeded', outcome: 'built', … } }
// Errors: NOT_FOUND (no entity view holds the kind, or no row has the ID); SERVICE_UNAVAILABLE
// (the owning consumer has no current version).

const near = await client.neighbourhood({ id: 'boxxy:item:0193a1b2-0000-7000-8000-000000000001', depthLimit: 2 });
// { entities: [ { id: 'boxxy:item:…01', kind: 'boxxy:item', …, depth: 0 },
//               { id: 'boxxy:attempt:…a1', kind: 'boxxy:attempt', …, depth: 1 } ],
//   links: [ { type: 'attempt_of', from: 'boxxy:attempt:…a1', to: 'boxxy:item:…01', direction: 'incoming', origin: 'boxxy_work', confidence: 1, depth: 1 },
//            { type: 'ran_in',     from: 'boxxy:attempt:…a1', to: 'telemetry:session:s-4c1', direction: 'outgoing', …, depth: 2 },
//            { type: 'produced',   from: 'boxxy:attempt:…a1', to: 'github:pull_request:9001', direction: 'outgoing', …, depth: 2 } ],
//   // A session is always here. `telemetry:session` is a kind (the family brings
//   // it) with no table and no entity view in v1, so no row can resolve it. The pull request is
//   // here until its fact arrives.
//   unresolved: ['github:pull_request:9001', 'telemetry:session:s-4c1'],
//   skippedConsumers: [], isTruncated: false }

// The same two procedures, and each plug-in query, as MCP tools at POST /mcp:
//   tools/list -> [ { name: 'get_entity', description, inputSchema, outputSchema },
//                   { name: 'neighbourhood', … }, { name: 'boxxy_cost_to_land', … }, … ]
//   tools/call { name: 'get_entity', arguments: { id: 'boxxy:attempt:none' } }
//     -> { isError: true, content: [{ type: 'text', text: '{"defined":true,"code":"NOT_FOUND","message":"no entity boxxy:attempt:none"}' }] }

// How the API runs a plug-in query (packages/api/src/app/create-router.ts):
declare const store: StoreReader;
declare const query: QueryDefinition;
declare const input: unknown;

const answer = await store.withConsumers(query.reads, (db) => query.handler({ input, db }));

if (!answer.ok) {
  // { reason: 'no-current-version', consumers: ['telemetry_turn_cost'] }: the handler did not run.
  // The API answers SERVICE_UNAVAILABLE and names the consumers, on /rpc and as an MCP tool error.
}

void [found, near];

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Types
// ═════════════════════════════════════════════════════════════════════════════════════════════

// ── 1. PORT: the store reader — packages/kit/src/store-reader/store-reader.ts ──────────────────
// The type lives in the kit (it moves from packages/api), because QueryCall names its `db`.
// Two adapters: Turso in @pepys/api, and one in-memory database in @pepys/testing.

// one row of a consumer file's `link` table (file 3, part E, has the table)
export interface LinkRow {
  type: string;
  from_id: string;
  to_id: string;
  scope: string | null;
  origin: string;
  confidence: number;
  evidence: string;
}

// The two views every `db` has. They cover the attached consumers only.
export interface SharedViews {
  // one row per entity of every entity view of every attached consumer
  entity: { id: string; kind: string; title: string; url: string | null; actor: string | null; updated_at: string };
  // The row has `scope`. v1 has no retraction, so the
  // view is a plain `union all` of the attached consumers' `link` tables.
  link_effective: LinkRow;
}

// the host's own tables of a consumer file, reached as `<consumer>.<table>`
export type HostTables<Consumers extends readonly ConsumerDeclaration[]> = {
  [Name in Consumers[number]['name'] as `${Name}.offsets`]: { stream: string; last_seq_num: number };
};

export type ConsumersDB<Consumers extends readonly ConsumerDeclaration[]> = StoreTables<Consumers> & HostTables<Consumers> & SharedViews;

export interface StoreReader {
  // Opens one read-only connection, attaches the current file of each consumer in `consumers`,
  // and runs `work` in one transaction on it. When one or more of `consumers` have no
  // current version, `work` does not run, and the failure names EVERY such consumer.
  // `whenCurrent` (the core queries use it): more consumers to attach, each only when it has a
  // current version. `db` has no typed table for them; their rows show in the two shared views.
  withConsumers: <const Consumers extends readonly ConsumerDeclaration[], Value>(
    consumers: Consumers,
    work: (db: Kysely<ConsumersDB<Consumers>>, call: AttachedCall) => Promise<Value>,
    options?: { whenCurrent?: readonly ConsumerDeclaration[] },
  ) => Promise<Result<Value, { reason: 'no-current-version'; consumers: readonly string[] }>>;
  close: () => Promise<void>;
}

export interface AttachedCall {
  // the version directory each attached consumer was read from, fixed for the whole call
  attached: Readonly<Record<string, { version: string }>>;
  // the `whenCurrent` consumers that had no current version
  skipped: readonly string[];
}

// Adapter 1 — packages/api/src/store-reader/create-store-reader.ts (changed). `withConsumer`
// (one consumer, by name) and the per-consumer `open` map go: a call owns its connection.
export declare function createStoreReader(options: { storeDirectory: string; openConnection: () => Promise<unknown> }): StoreReader;

// Adapter 2 — packages/testing/src/create-memory-store-reader.ts (new). No files and no attach.
// `markDown` gives a test the `no-current-version` path.
export interface MemoryStoreReader extends StoreReader {
  markDown: (consumer: string) => void;
}

export declare function createMemoryStoreReader(deployment: CheckedDeployment): Promise<MemoryStoreReader>;

// ── 2. MODULE: link types as TypeScript sees them — packages/kit/src/links/ ────────────────────

// Where a link type lives. One declaration, and no second list in any file:
//   declared   `defineLinkType`, listed in `links` of each consumer that writes it
//   joined     `checkDeployment` -> `CheckedDeployment.linkTypes`, once per name; a name that two
//              plug-ins declare is a `duplicate` failure, also when the two agree
//   host       `manifest.links` of each consumer, whole (file 3). consumers.json has no registry.
//   API        `buildLinkRegistry(deployment.linkTypes)` at start, for `neighbourhood`
// Out of v1: a link target written as a reference, a manual origin, a retraction.
export type LinkRegistry = ReadonlyMap<string, LinkTypeDeclaration>;

export declare function buildLinkRegistry(linkTypes: readonly LinkTypeDeclaration[]): LinkRegistry;

// One "not declared" problem: the host has no deployment registry, so the consumer declares a
// type or nothing does.
export type LinkProblem =
  | { kind: 'not-declared'; type: string; consumer: string }
  | { kind: 'not-an-entity-id'; end: 'from' | 'to'; id: string }
  | { kind: 'wrong-kind'; end: 'from' | 'to'; id: string; allowed: readonly EntityKind[] }
  | { kind: 'bad-confidence'; confidence: number }
  | { kind: 'no-evidence' };

// packages/kit/src/links/find-link-problem.ts (new, pure). The test store calls it. The host's
// check_link is its Rust twin. packages/kit/src/links/link-check-cases.json, a list of
// { name, consumer: { name, links }, link, problem: <kind> | null }, runs against both.
export declare function findLinkProblem(
  consumer: { name: string; links: readonly LinkTypeDeclaration[] },
  link: { type: string; from: string; to: string; confidence: number; evidence: string },
): LinkProblem | undefined;

// ── 3. MODULE: the core queries ────────────────────────────────────────────────────────────────

// packages/api/src/queries/entity-kinds/build-entity-kind-index.ts (replaces
// find-entity-consumer.ts, which matched the source of a stream name). Which consumer and which
// table hold a kind, from the entity views. `checkDeployment` refuses two views of one kind.
export interface EntityOwner {
  consumer: ConsumerDeclaration;
  view: EntityViewDeclaration;
}

export type EntityKindIndex = ReadonlyMap<EntityKind, EntityOwner>;

export declare function buildEntityKindIndex(consumers: readonly ConsumerDeclaration[]): EntityKindIndex;

// packages/api/src/queries/types.ts (changed)
export interface QueryContext {
  store: StoreReader;
  deployment: CheckedDeployment;
  entityKinds: EntityKindIndex;
  linkRegistry: LinkRegistry;
}

export type QueryFailure = { code: 'NOT_FOUND' | 'BAD_REQUEST' | 'SERVICE_UNAVAILABLE'; message: string };

// packages/contract/src/core-contract/core-contract.ts (changed). Two procedures. search,
// entity_history, assert_link, retract_link and correct_label leave it: each would be an MCP tool
// that always fails. Every field has a zod `.describe()` text, which the MCP input schema carries.
// IDs are plain `z.string()` here, with no `.transform`: no run has checked a schema
// with a transform in an MCP input or output schema.
export interface EntitySummary {
  id: string;
  kind: string; // `<source>:<kind>`
  title: string;
  url: string | null;
  actor: string | null;
  updated_at: string;
}

export interface GetEntityInput {
  id: string; // 'The entity ID, as <source>:<kind>:<id>, such as github:pull_request:9001.'
}

export interface GetEntityOutput {
  entity: EntitySummary;
  consumer: string;
  table: string;
  row: Record<string, unknown>; // the full row, each column as its declared kind
}

export declare const neighbourhoodCaps: {
  readonly depthLimit: { readonly default: 1; readonly max: 3 };
  readonly entityLimit: { readonly default: 50; readonly max: 200 };
  readonly linkReadLimit: 1000; // link rows read per hop; fixed, not an input
};

export interface NeighbourhoodInput {
  id: string; // 'The entity to start from.'
  depthLimit: number; // 1 to 3, default 1
  entityLimit: number; // 1 to 200, default 50, the start included
  linkTypes: readonly string[] | null; // default null: every link type
  includeHubs: boolean; // default false
  minimumConfidence: number; // 0 to 1, default 0
}

export interface NeighbourhoodOutput {
  // the start first (depth 0), then by depth, then by ID; only the entities that have a row
  entities: readonly (EntitySummary & { depth: number })[];
  // every followed link, by depth, type, from, to
  links: readonly { type: string; from: string; to: string; direction: 'outgoing' | 'incoming'; origin: string; confidence: number; depth: number }[];
  // IDs that a link names and that no attached entity view holds
  unresolved: readonly string[];
  skippedConsumers: readonly string[];
  // true when `entityLimit` or the per-hop read limit cut the walk short
  isTruncated: boolean;
}

// The description of each procedure comes from `oc.meta(openapi({ description }))`
// (@orpc/openapi). oRPC v2 has no `oc.route({ description })`.
//   get_entity:    oc.errors({ NOT_FOUND: {}, SERVICE_UNAVAILABLE: {} }).meta(openapi({ description })).input(…).output(…)
//   neighbourhood: oc.errors({ NOT_FOUND: {}, BAD_REQUEST: {} }).meta(openapi({ description })).input(…).output(…)
export declare const coreContract: { get_entity: unknown; neighbourhood: unknown };

export declare function readEntity(context: QueryContext, id: string): Promise<Result<GetEntityOutput, QueryFailure>>;
export declare function walkNeighbourhood(context: QueryContext, input: NeighbourhoodInput): Promise<Result<NeighbourhoodOutput, QueryFailure>>;

// pure parts of the walk, each with a table test and no database
export declare function pickLinkTypes(registry: LinkRegistry, input: Pick<NeighbourhoodInput, 'linkTypes' | 'includeHubs'>): Result<readonly string[], { unknown: readonly string[]; known: readonly string[] }>;

export interface WalkState {
  depths: ReadonlyMap<string, number>; // every ID seen, with its depth; the cycle guard
  links: NeighbourhoodOutput['links'];
  frontier: readonly string[];
  isTruncated: boolean;
}

export declare function takeHop(state: WalkState, rows: readonly LinkRow[], hop: { depth: number; entityLimit: number; linkReadLimit: number }): WalkState;

// ── 4. The API process — packages/api/src ──────────────────────────────────────────────────────

export interface APIConfig {
  storeDirectory: string; // PEPYS_STORE_DIR
  host: string; // PEPYS_API_HOST, default '127.0.0.1'
  port: number; // PEPYS_API_PORT, default 8081
}

export declare function serveAPI(options: { deployment: Deployment; environment: Readonly<Record<string, string | undefined>> }): Promise<void>;

// The typed client of one deployment: the core procedures and each plug-in query by its name.
// The plug-in part is the kit's `PluginClient` (file 1, part G), once per plug-in. A
// package that needs one plug-in's queries uses `PluginClient` alone and imports no @pepys/api.
export type DeploymentClient<Target extends Deployment> = {
  get_entity: (input: GetEntityInput) => Promise<GetEntityOutput>;
  neighbourhood: (input: Pick<NeighbourhoodInput, 'id'> & Partial<NeighbourhoodInput>) => Promise<NeighbourhoodOutput>;
} & UnionToIntersection<PluginClient<Target['plugins'][number]>>;

type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (value: infer Intersection) => void ? Intersection : never;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Flow
// ═════════════════════════════════════════════════════════════════════════════════════════════

// ── 5. One `withConsumers` call (the Turso adapter) ────────────────────────────────────────────
//
//   a. Resolve the `current` link of every named consumer with realpath, before anything opens.
//      The call uses those directories to its end.
//   b. A required consumer with no `current`: stop; `work` never runs; the failure names each one.
//      A `whenCurrent` consumer with none is left out and named in `call.skipped`.
//   c. One new connection per call, on an empty in-memory main database. Each file is attached
//      read-only under the consumer's name:  ATTACH 'file:<directory>/consumer.db?mode=ro' AS "boxxy_work"
//      A read-only attach keeps the snapshot it took when it attached, and v1 has no change feed
//      to say when to attach again, so no connection is kept between calls.
//   d. Two TEMP views on the connection:
//        entity          `union all` of "<consumer>".entity, for each attached consumer with entity views
//        link_effective  `union all` of "<consumer>".link, for each attached consumer with link types
//      With none, the view is one SELECT of typed NULLs with WHERE 0. A table name with no schema
//      finds the consumer's table, because table names are unique in a deployment.
//   e. One transaction around `work`: one snapshot of each file. Two files are never read at one
//      instant: the host commits each consumer's batch in its own file.
//   f. The connection closes with the call.
// A version swap in the middle of a call: the call ends on the version it resolved in step a; the
// host keeps the old directory. The next call reads the new version. No event is needed.
// Fallback when Turso refuses a TEMP view over attached files (not checked): the adapter builds
// the two unions as Kysely common table expressions per query.

// ── 6. get_entity and neighbourhood ────────────────────────────────────────────────────────────
//
// get_entity: the kind is in the ID; the entity kind
// index gives the owning consumer and table; attach that one file; read the `entity` view, then
// the full row with raw SQL whose names come from the declaration, never from the input.
//   - a kind with no entity view (such as `telemetry:session`): NOT_FOUND
//   - the owner has no current version: SERVICE_UNAVAILABLE
//
// neighbourhood: a breadth-first walk in TypeScript. Attach every consumer through `whenCurrent`
// (none is required, so the call cannot fail with `no-current-version`). One query on
// `link_effective` per hop, both directions, ordered by type, from, to, origin, limited to
// `linkReadLimit + 1` rows; `takeHop` after each; then one query on `entity` for the summaries.
//   takeHop: rows over the limit are dropped and `isTruncated` is set; rows with the same type
//   and ends from two origins become one link, with the highest confidence; an ID is expanded
//   once, at the depth it was first seen; new IDs are added in ID order up to `entityLimit`.
// The start's kind must be one a plug-in brings (CheckedDeployment.entityKinds), else NOT_FOUND.
// It need not have an entity view: a walk may start from a session.
// Caps: depth 1 by default and 3 at most; 50 entities by default and 200 at most; 1000 link rows
// per hop; a hub link type is followed only with `includeHubs`. A cut walk is not an error.

// ── 7. The router and the MCP tools — packages/api/src/app/create-app.ts ───────────────────────
//
// Packages, all pinned to one exact version (`@orpc/mcp` pins its siblings exactly):
//   @orpc/contract, @orpc/server, @orpc/client, @orpc/openapi, @orpc/mcp   2.0.0-beta.50 (the `beta` tag)
//   @modelcontextprotocol/server                                           2.x (the v1 SDK package does not fit)
//   zod                                                                    4.2 or later, no `@orpc/zod` converter
//
// At start (`serveAPI`):
//   a. readAPIConfig and checkDeployment; exit 1 on a failure.
//   b. context = { store, deployment, entityKinds, linkRegistry }.
//   c. core = implement(coreContract).$context<QueryContext>(); each handler maps a QueryFailure to
//      `errors[failure.code]({ message })`.
//   d. One contract and one router per plug-in query:
//        oc.errors({ SERVICE_UNAVAILABLE: {} }).meta(openapi({ description: query.description }))
//          .input(query.input).output(query.output)
//      Its handler is `store.withConsumers(query.reads, (db) => query.handler({ input, db }))`.
//   e. router = Object.assign({}, coreRouter, ...pluginRouters). The keys are flat and snake case,
//      so the MCP tool name is the key as it is. A clash of two keys makes `register` throw at start.
//   f. /rpc: `new RPCHandler(router, { errorStatusMap })`. A contract's `status` has no effect in
//      v2: the map on the handler gives each code its HTTP status, and a code it lacks gets 400.
//      The map here names SERVICE_UNAVAILABLE as 503 itself, so it does not rest on the common map.
//   g. /mcp: `new McpRegistrar(router)` once; `createMcpHandler` makes one McpServer per request
//      (stateless) and `registrar.register(server, { context })`. Both mount through Elysia with
//      `parse: 'none'`.
//   h. app.listen({ hostname: config.host, port: config.port }).
// As an MCP tool: the description is the `openapi({ description })` text; the input schema is the
// zod input as JSON Schema with each field's `.describe()` text; a result is `structuredContent`;
// a typed error is `isError: true` with the code and the message as text. No tool is registered
// by hand, and none can write: the API has no write procedure in v1.
