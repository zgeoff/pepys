// pepys v1, file 3 of 5: the boundary between `pepys build` and `pepys-host`.
// consumers.json, the shared case file, the wire, scope mode, the fact index, links in the host.
// Rust is written as comments. Not compiled or type-checked.
//
// Home file of: ConsumerBuildManifest, ListedConsumer, ConsumerVersion, ConsumerManifest,
// ManifestRead, ManifestTable, WireOperation, WireLink, the Rust host's types.

import type { CheckedDeployment, ColumnKind, ConsumerDeclaration, ConsumerInput, LinkTypeDeclaration } from './01-kit.ts';

declare type VersionHash = string;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Usage
// ═════════════════════════════════════════════════════════════════════════════════════════════

// build/consumers/consumers.json, as `pepys build` writes it. One entry, abridged to one table.
// The hashes are invented.
export const example = {
  kit: 1,
  deployment: 'harbour',
  consumers: [
    {
      name: 'boxxy_work',
      module: '5f1d0c9a…',
      path: 'boxxy_work/5f1d0c9a….wasm',
      pins: {},
      version: 'c27ab4e0…',
      manifest: {
        name: 'boxxy_work',
        input: { mode: 'scope', scopeKind: 'boxxy:item', streams: ['facts.boxxy.work'] },
        exports: { init: 'boxxy_work_init', apply: 'boxxy_work_apply_scope' },
        imports: [{ kind: 'scope_facts', length: 'readScopeFactsLength', into: 'readScopeFactsInto' }],
        tables: {
          // the table as the boxxy pepys package declares it, whole
          boxxy_attempt_session: {
            columns: {
              attempt_id: { kind: 'entityID', nullable: false },
              session_id: { kind: 'entityID', nullable: false },
              key: { kind: 'text', nullable: false },
              product: { kind: 'text', nullable: true },
              bound_at: { kind: 'timestamp', nullable: false },
            },
            primaryKey: ['attempt_id', 'session_id'],
            indexes: [['session_id']],
          },
        },
        links: [
          { name: 'ran_in', from: ['boxxy:attempt'], to: ['telemetry:session'], hub: false },
          { name: 'produced', from: ['boxxy:attempt'], to: ['github:pull_request'], hub: false },
          { name: 'attempt_of', from: ['boxxy:attempt'], to: ['boxxy:item'], hub: false },
        ],
        schema: 'CREATE TABLE "boxxy_attempt_session" (\n  "attempt_id" TEXT NOT NULL,\n  …\n);\nCREATE VIEW "entity" AS …;\n',
      },
    },
  ],
} satisfies ConsumerBuildManifest;

// A fact-mode entry differs in three fields:
//   input:   { mode: 'fact', streams: ['facts.github.ref', 'facts.github.deployment'] }
//   exports: { init: 'github_deploy_init', apply: 'github_deploy_apply_fact' }
//   imports: [{ kind: 'row', table: 'github_deploy', length: 'readGithubDeployLength', into: 'readGithubDeployInto' }]

// The host's commands (crates/host/src/main.rs). One global flag names the file.
//
//   pepys-host run [--up] --consumers <consumers.json>      env PEPYS_CONSUMERS
//   pepys-host up [<consumer>] [--version <hash>]           no name: every listed consumer, in file order
//   pepys-host preview <consumer>

// ═════════════════════════════════════════════════════════════════════════════════════════════
// A. consumers.json — packages/schema/src/consumer-execution/types.ts (changed)
// ═════════════════════════════════════════════════════════════════════════════════════════════

// No top-level `linkTypes` or `entityKinds`. Each manifest
// holds its link types whole, so one entry is all the host needs for one consumer, and a kept
// version needs no file but its own `version.json`.
export interface ConsumerBuildManifest {
  kit: 1;
  deployment: string | null;
  consumers: readonly ListedConsumer[];
}

// The repo's ConsumerVersion, unchanged in its fields. The build fills it for the first time.
export interface ConsumerVersion {
  name: string;
  module: VersionHash; // sha256 of the module's bytes; the host checks it against the file
  pins: Readonly<Record<string, VersionHash>>; // enrichment champions; `{}` in v1
  // sha256 over `module`, `pins` and `manifest`, as JSON with sorted keys. The build computes it;
  // the host uses it as the name of `store/<name>/<version>/` and never computes it. A changed
  // index or link type with the same module bytes is therefore a new version.
  version: VersionHash;
  manifest: ConsumerManifest;
}

export interface ListedConsumer extends ConsumerVersion {
  path: string; // the module file, relative to consumers.json
}

export interface ConsumerManifest {
  name: string;
  // The kit's ConsumerInput, the same object the declaration holds. It replaces the repo's
  // `mode: { kind, stream }`.
  input: ConsumerInput;
  // The two symbols the host calls. The host builds no symbol from a name. Checked
  // in the repo: module_runner.rs calls `_initialize` (a fixed name of the wasm reactor),
  // `<name>_init` and `<name>_apply_fact`, and no other export of the module.
  exports: { init: string; apply: string };
  // Every read import the host serves, with its two symbols. It is named `imports`,
  // not `reads`, because the declaration's `reads` means something narrower: the row tables of a
  // fact-mode consumer. The streams of a `scope_facts` import are `input.streams`: they are in
  // the file once.
  imports: readonly ManifestRead[];
  tables: Readonly<Record<string, ManifestTable>>;
  // whole declarations: name, `from` kinds, `to` kinds, `hub`
  links: readonly LinkTypeDeclaration[];
  // The SQL that the kit's generator writes: the consumer's tables, its indexes, and the file's
  // `entity` view (a `union all` of the declaration's `entityViews`). The host runs it on a new
  // file. It holds none of the host's own tables (part E).
  schema: string;
}

// Two calls per read, as today: `length(argument) -> f64` and `into(argument, buffer)`.
export type ManifestRead =
  // fact mode: one row of one of the consumer's own tables; the argument is the row's key
  | { kind: 'row'; table: string; length: string; into: string }
  // scope mode: every fact of the scope's entity; the argument is the scope ID
  | { kind: 'scope_facts'; length: string; into: string };

export interface ManifestTable {
  columns: Readonly<Record<string, { kind: ColumnKind; nullable: boolean }>>;
  primaryKey: readonly string[];
  indexes: readonly (readonly string[])[];
}

// packages/cli/src/build/build-consumer-manifest.ts (new). In the CLI, not in the kit: the type
// is in @pepys/schema, which imports the kit. It calls the kit's generateSqliteSchema for `schema`.
export declare function buildConsumerManifest(consumer: ConsumerDeclaration): ConsumerManifest;

// packages/cli/src/build/build-version-hash.ts (new)
export declare function buildVersionHash(parts: Pick<ConsumerVersion, 'module' | 'pins' | 'manifest'>): VersionHash;

// packages/cli/src/build/write-build-manifest.ts (new). It parses its own output with
// consumerBuildManifestSchema (part B) before it writes, so the build never writes a file that
// the TypeScript side of the case file would refuse.
export declare function writeBuildManifest(out: string, deployment: CheckedDeployment, modules: readonly { name: string; module: string; path: string }[]): Promise<void>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// B. One case file, checked from both languages
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// packages/schema/src/consumer-manifest-cases.json (new), in the shape of packages/kit/src/fact-envelope-cases.json:
//
//   [ { "name": "a scope consumer with two link types", "accepted": true,  "file": { …a whole consumers.json… } },
//     { "name": "an unknown field in a table",          "accepted": false, "file": { … } },
//     { "name": "a scope consumer with a row read",     "accepted": false, "file": { … } },
//     { "name": "kit 2",                                "accepted": false, "file": { … } }, … ]
//
// TypeScript: packages/schema/src/consumer-execution/consumer-manifest.test.ts. A strict zod
//   schema, `consumerBuildManifestSchema` (z.strictObject at every level), must accept each
//   accepted case and refuse each other one. One accepted case, "the stub deployment", must equal
//   byte for byte what `writeBuildManifest` gives for the repo's stub deployment (e2e/deployment.ts),
//   so the writer and the cases cannot part.
// Rust: crates/host/src/consumer.rs `mod tests` reads the same file with include_str! and checks
//   that `read_build_manifest_text` accepts and refuses the same cases.
//
// Strict parsing in the host: `#[serde(deny_unknown_fields)]` on every struct, and every union is
// an internally tagged enum (`mode` for the input, `kind` for a read). A file from a newer build
// with a field this host does not know fails at `up` or at the start of `run`, with the field.
//
// One load path, so that no caller can skip the check:
// `read_build_manifest` and `read_version` both end in `check_consumer_version`, and no public
// function returns a ConsumerVersion that did not pass it. The rules it holds:
//   - `kit` is 1; no consumer name twice; no table in two consumers (file level);
//   - fact mode: every import is `row` and names a table of `tables`;
//   - scope mode: exactly one import, of kind `scope_facts`;
//   - `input.streams` is not empty; no link type name twice; no export or import symbol empty or twice;
//   - no table of `tables` has a reserved name (link, entity, offsets, change_log, applied_facts, scope_row);
//   - every primary key column and index column is a column of its table.

// ═════════════════════════════════════════════════════════════════════════════════════════════
// C. The wire between a module and the host, and the generated glue
// ═════════════════════════════════════════════════════════════════════════════════════════════

// The module returns one JSON list. Each item has exactly one verb. The keyed shape is today's
// (the glue and `parse_operations`). FactOperation and ScopeOperation of
// consumer-execution/types.ts go: they describe a shape nothing sends.
export type WireOperation =
  | { upsert: Readonly<Record<string, WireRow>> } // one table name, one row with every column
  | { delete: Readonly<Record<string, WireRow>> } // one table name, the primary key columns; fact mode only
  | { link: WireLink } // both modes
  | { unlink: Pick<WireLink, 'type' | 'from' | 'to'> }; // fact mode only

export type WireRow = Readonly<Record<string, string | number | boolean | null | object>>;

// Flat, with the type as a field and both ends as entity IDs.
export interface WireLink {
  type: string;
  from: string;
  to: string;
  confidence: number; // 0 to 1
  evidence: string; // a fact ID; not empty
}

// boxxy repo, packages/pepys/src/generated/boxxy-work-boundary.ts — written by `pepys build`
// (generateBoundaryGlue in @pepys/kit/generators). The scope and link parts:
//
// The glue of a consumer whose plug-in declares settings also holds the
// checked values, as one constant that the entry file imports. For the GitHub deploy consumer:
//   export const settings = { deployTagPattern: 'deployed/<environment>' } as const;
// The host passes no setting and the module reads none at run time. The manifest and
// consumers.json do not change: the values are in the module's bytes, so `buildVersionHash`
// gives a new version when a setting changes.

declare function readScopeFactsLength(scope: string): number; // the symbols of the manifest's `scope_facts` read
declare function readScopeFactsInto(scope: string, facts: Uint8Array): void;

// Two tags, because scriptc refuses a brand whose tag is a type parameter (SC2009): `EntityID`
// carries a fixed tag, and each kind adds a second one with the kind as a literal.
declare const idTag: unique symbol;
declare const kindTag: unique symbol;
export type EntityID = string & { readonly [idTag]: 'EntityID' };
type KindedID<Kind extends string> = EntityID & { readonly [kindTag]: Kind };
export type BoxxyItemID = KindedID<'boxxy:item'>;
export type BoxxyAttemptID = KindedID<'boxxy:attempt'>;
export type GithubPullRequestID = KindedID<'github:pull_request'>;

// Per kind: to<Kind>ID builds the ID from the source's own ID and throws on an empty one;
// parse<Kind>ID answers undefined for text of another kind.
export declare function toGithubPullRequestID(id: string): GithubPullRequestID;
export declare function parseGithubPullRequestID(text: string): GithubPullRequestID | undefined;

// The scriptc model contract. scriptc takes the two types through the entry file's
// `export type { … } from` but refuses re-exported functions, so the entry file declares `init`
// and `update` and calls these.
export interface BoxxyWorkModel { input: string }
export type BoxxyWorkMessage = { kind: 'apply'; input: string } | { kind: 'reset' };
export declare function initBoxxyWorkModel(): BoxxyWorkModel;
export declare function updateBoxxyWorkModel(model: BoxxyWorkModel, message: BoxxyWorkMessage): BoxxyWorkModel;

// One member per fact type of the families on the consumer's streams (27 for boxxy; 3 shown).
// The names and fields are the fact catalog's, in the boxxy repo
// (docs/design/boxxy/sketches/v1/core/04-facts.ts). Each member also holds `entity: string`,
// left out here. Fact types whose payload schema is one object share a member and a payload type.
export type BoxxyWorkFact =
  | { id: string; type: 'boxxy.item.filed'; at: string; payload: { kind: string; repo: string; title: string; fields: { designMode?: string }; acceptance: { text: string; evidence: string[] }[]; foundInAttempt: string | null } }
  | { id: string; type: 'boxxy.attempt.session_bound'; at: string; payload: { attempt: string; atcSession: string; agentSession: string; product: string; source: 'worker' | 'hook'; seenAt: number } }
  | { id: string; type: 'boxxy.pull_request.linked'; at: string; payload: { attempt: string; repo: string; number: number; url: string; pullRequestId: string /* decimal text */; source: 'hook' | 'watch' } };

// How generateBoundaryGlue types a payload, from the family's zod schema. It walks the
// schema; it runs no zod in the module.
//   zod schema                               the glue's type            the decoder
//   string, number, boolean                  the same                   a `typeof` check
//   a string format, such as a UUID          `string`                   a `typeof` check, not the format
//   a literal, an enum                       the literal union          a type guard over the values
//   a brand (no transform)                   the type under the brand   as that type
//   object                                   an object type, nested     field by field, to any depth
//   array                                    `Member[]`                 an index loop over the list
//   optional field, or one with a default    `field?: Type`             absent is kept absent
//   nullable                                 `Type | null`              null is kept
//   anything else: a record, a union of      `unknown`                  the value is passed through
//   object shapes, a transform, a lazy                                  as parsed, with no check
//   schema, a tuple
// A fact whose payload does not decode (a required field absent, or of the wrong type) is left
// out of `readScopeFacts`, as a fact of an unknown type is. `unknown` never fails a decode.
// The members above show each rule but the last: a nested object with an optional field
// (`fields.designMode`), a list of objects (`acceptance`), a nullable field (`foundInAttempt`).
// `ItemRow.fields` is a record in the catalog; the glue types the keys the family's schema names
// and no others. A field typed `unknown` (the catalog's `CloseOut` union) is one the entry file
// must not read without its own checks.
//
// What a compile and a run of the real `boxxy_work` entry file proved for these rules, and what
// no run has checked: docs/design/v1-open.md, "scriptc".

// Every fact of the scope's entity on the consumer's streams, one per fact ID, in order.
export function readScopeFacts(scope: BoxxyItemID): BoxxyWorkFact[] {
  const buffer = new Uint8Array(readScopeFactsLength(scope));

  readScopeFactsInto(scope, buffer);

  const parsed: unknown = JSON.parse(new TextDecoder().decode(buffer));
  const facts: BoxxyWorkFact[] = [];

  if (!Array.isArray(parsed)) {
    return facts;
  }

  // An index loop. `for...of` and `.filter` over the untyped parse result make scriptc link its
  // dynamic invoke object.
  for (let index = 0; index < parsed.length; index += 1) {
    const fact = decodeBoxxyWorkFact(parsed[index]); // field by field from `unknown`, no cast

    // a fact whose type no family of the consumer's streams declares is left out
    if (fact !== undefined) {
      facts.push(fact);
    }
  }

  return facts;
}

export type BoxxyWorkOperation =
  | { upsert: { boxxy_attempt_session: { attempt_id: BoxxyAttemptID; session_id: KindedID<'telemetry:session'>; key: 'atc' | 'agent'; product: string | null; bound_at: string } } }
  | { link: { type: 'produced'; from: BoxxyAttemptID; to: GithubPullRequestID; confidence: number; evidence: string } };

// one constructor per entry of the declaration's `links`; the kinds of the ends are in the types
export function linkProduced(link: { from: BoxxyAttemptID; to: GithubPullRequestID; confidence: number; evidence: string }): BoxxyWorkOperation {
  return { link: { type: 'produced', from: link.from, to: link.to, confidence: link.confidence, evidence: link.evidence } };
}

declare function decodeBoxxyWorkFact(value: unknown): BoxxyWorkFact | undefined;

// A fact consumer gets `parse<Consumer>Fact(factJSON)` in place of `readScopeFacts`, a delete
// per table and an unlink per link type. Each table in the declaration's `reads`, and no other,
// gets `read<Table>Row(key)` over the host's `read<Table>Length` and `read<Table>Into`; a length
// of -1 means no row, and a row that does not decode, such as an ID of another kind, reads as none.

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D. The Rust host's types and signatures (crates/host/src)
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// What goes: crates/schema (the whole crate), generate-rust-types.ts, pull_request_rows.rs, the
// static GITHUB_PULL_REQUEST spec, scripts/build-consumers.ts and its three sibling scripts.
// After this no production file under crates/ holds the name of a source, a table or a consumer.
//
// consumer.rs — owned values that serde reads; every struct has deny_unknown_fields.
//
//   pub struct BuildManifest { pub kit: u32, pub deployment: Option<String>, pub consumers: Vec<ConsumerVersion> }
//   pub struct ConsumerVersion { pub name: String, pub module: String,
//                                #[serde(default)] pub path: String,       // empty in a stored version.json
//                                pub pins: BTreeMap<String, String>, pub version: String, pub manifest: ConsumerManifest }
//   #[serde(rename_all = "camelCase")]
//   pub struct ConsumerManifest { pub name: String, pub input: ConsumerInput, pub exports: Exports,
//                                 pub imports: Vec<Read>, pub tables: BTreeMap<String, TableInfo>,
//                                 pub links: Vec<LinkType>, pub schema: String }
//   #[serde(tag = "mode", rename_all = "camelCase", rename_all_fields = "camelCase")]
//   pub enum ConsumerInput { Fact { streams: Vec<String> }, Scope { scope_kind: String, streams: Vec<String> } }
//   impl ConsumerInput { pub fn streams(&self) -> &[String] }
//   pub struct Exports { pub init: String, pub apply: String }
//   #[serde(tag = "kind", rename_all = "snake_case")]
//   pub enum Read { Row { table: String, length: String, into: String }, ScopeFacts { length: String, into: String } }
//   pub struct TableInfo { pub columns: BTreeMap<String, ColumnInfo>, pub primary_key: Vec<String>, pub indexes: Vec<Vec<String>> }
//   pub struct ColumnInfo { pub kind: ColumnKind, pub nullable: bool }
//   pub enum ColumnKind { Text, Integer, Real, Boolean, Json, EntityId, Timestamp }
//   pub struct LinkType { pub name: String, pub from: Vec<String>, pub to: Vec<String>, pub hub: bool }
//
//   /// Parses strictly and checks (part B). The only way to get a BuildManifest.
//   pub fn read_build_manifest(path: &Path) -> Result<BuildManifest, HostError>
//   pub fn read_build_manifest_text(text: &str) -> Result<BuildManifest, HostError>      // the case file test
//   pub fn find_consumer<'a>(file: &'a BuildManifest, name: &str) -> Result<&'a ConsumerVersion, HostError>
//   /// The version.json of a version directory, through the same check.
//   pub fn read_version(directory: &Path) -> Result<ConsumerVersion, HostError>
//
// rows.rs — replaces pull_request_rows.rs. A row is a JSON object; the table comes from the manifest.
//
//   pub type Row = serde_json::Map<String, Value>;
//   /// Every column present, no other key, each value of the column's kind, null only where nullable.
//   pub fn check_row(table: &str, info: &TableInfo, row: &Row) -> Result<(), HostError>
//   /// The primary key as text: the JSON list of the key's values, in `primary_key` order. One
//   /// form for a key of one column and of several. The change log and `scope_row` hold it.
//   pub fn key_of(info: &TableInfo, row: &Row) -> Result<String, HostError>
//   pub async fn load_row(c: &Connection, table: &str, info: &TableInfo, key: &str) -> Result<Option<Row>, HostError>
//   pub async fn write_row(c: &Connection, table: &str, info: &TableInfo, row: &Row) -> Result<(), HostError>
//   pub async fn delete_row(c: &Connection, table: &str, info: &TableInfo, key: &str) -> Result<(), HostError>
//
// batch.rs — fact mode keeps its place. The parse turns the wire into domain values once; every
// function after it takes `Operation` and `Link`, never the wire types.
//
//   pub enum Operation { Upsert { table: String, row: Row }, Delete { table: String, key: String },
//                        Link(Link), Unlink { link_type: String, from: String, to: String } }
//   pub fn parse_operations(manifest: &ConsumerManifest, output: &str) -> Result<Vec<Operation>, HostError>
//   pub async fn apply_batch(store: &Store, manifest: &ConsumerManifest, runner: &mut dyn FactRunner,
//                            stream: &str, facts: &[StoredFact]) -> Result<(), HostError>
//
// scope.rs — new; the scope twin of batch.rs. Two ports, because a test fakes each.
//
//   pub trait ScopeRunner { fn apply_scope(&mut self, scope: &str, facts: Arc<dyn FactSource>) -> Result<String, HostError>; }
//   pub trait FactSource: Send + Sync { fn read_scope_facts(&self, scope: &str) -> Result<Vec<u8>, HostError>; }
//   /// Serves one scope from the consumer file's index; any other scope is ForeignScopeRead.
//   pub struct IndexFacts { .. }   impl FactSource for IndexFacts
//   pub async fn apply_scope_batch(store: &Store, manifest: &ConsumerManifest, scope_kind: &str,
//                                  runner: &mut dyn ScopeRunner, stream: &str, facts: &[StoredFact]) -> Result<(), HostError>
//
// scope_replace.rs — new. The diff, split as the code style asks: two pure steps between a read and a write.
//
//   pub async fn replace_scope(c: &Connection, manifest: &ConsumerManifest, scope: &str, output: &str) -> Result<Vec<Value>, HostError>
//   pub fn collect_scope_result(manifest, scope, operations: Vec<WireOperation>) -> Result<ScopeResult, HostError>
//   pub async fn read_scope_state(c, manifest, scope, result: &ScopeResult) -> Result<ScopeState, HostError>
//   pub fn pick_scope_changes(scope, result: &ScopeResult, state: &ScopeState) -> Result<ScopeChanges, HostError>
//   pub async fn write_scope_changes(c, manifest, scope, changes: &ScopeChanges) -> Result<(), HostError>
//
// entity_ids.rs — the rule of the kit's parseEntityID; the envelope check uses it too.
//
//   /// `<source>:<kind>` of an entity ID, or None: lowercase name parts, a source that is no fact
//   /// kind, and an ID part that is not empty.
//   pub fn kind_of(id: &str) -> Option<&str>
//
// links.rs
//
//   pub struct Link { pub link_type: String, pub from: String, pub to: String, pub confidence: f64, pub evidence: String }
//   pub struct LinkEnds { pub link_type: String, pub from: String, pub to: String }
//   /// The kit's five problem kinds, so the case file checks the kind and not a pass or a fail.
//   pub enum LinkProblem { NotDeclared { .. }, NotAnEntityId { .. }, WrongKind { .. }, BadConfidence { .. }, NoEvidence }
//   /// The Rust twin of findLinkProblem (file 4). It takes the manifest's link types alone.
//   pub fn find_link_problem(link_types: &[LinkType], link: &Link) -> Option<LinkProblem>
//   pub async fn load_link(c: &Connection, ends: &LinkEnds) -> Result<Option<Link>, HostError>
//   pub async fn write_link(c: &Connection, origin: &str, scope: Option<&str>, link: &Link) -> Result<(), HostError>
//   pub async fn delete_link(c: &Connection, ends: &LinkEnds) -> Result<(), HostError>
//
// fact_index.rs — new. The `scope_fact` table of a scope consumer's own file, written inside the
// batch's transaction, so a rollback leaves no index row and the file's offsets bound every read.
//
//   pub async fn index_facts(c: &Connection, stream: &str, facts: &[StoredFact]) -> Result<(), HostError>
//   pub async fn read_entity_facts(c: &Connection, entity: &str) -> Result<String, HostError>   // one JSON list
//   /// `at` with its fraction set to 9 digits, so text order is time order.
//   pub fn sort_key_of(at: &str) -> String
//
// module_runner.rs — `ModuleRunner::new(bytes, manifest)` links each `imports[]` pair by the symbols
// the manifest names and calls `exports.init` and `exports.apply`. It builds no name with format!.
//
// commands.rs
//
//   pub struct HostConfig { pub s2: S2Settings, pub store_dir: PathBuf, pub consumers: PathBuf }
//   /// The ONE way a version is opened: `up`, `run`, `preview` and the tests all call it.
//   /// On a new file it runs `manifest.schema`, then makes the host's tables. On every open it
//   /// then checks the file against `manifest.tables` (part F, step 3 of `up`).
//   async fn open_version(directory: &Path, manifest: Arc<ConsumerManifest>) -> Result<Version, HostError>
//   pub async fn run(config: &HostConfig, up_first: bool) -> Result<(), HostError>
//   pub async fn up(config: &HostConfig, consumer: Option<&str>, kept: Option<&str>) -> Result<String, HostError>
//   pub async fn preview(config: &HostConfig, consumer: &str) -> Result<serde_json::Value, HostError>
//
// error.rs — new variants.
//
//   BadManifest { path: String, reason: String }          // the JSON path of the field, and why
//   SchemaMismatch { table: String, reason: String }      // `schema` and `tables` disagree
//   BadLink(LinkProblem)                                  // the scope replace's `bad-link`
//   DuplicateRow { scope: String, table: String, key: String }  // one key twice in a scope's result
//   DuplicateLink { scope: String, key: String }
//   ScopeConflict { scope: String, table: String, key: String, owner: Option<String> }
//   ForeignScopeRead { scope: String, asked: String }       // the module traps
//   NoCurrentVersion(String)                              // "<consumer> has no current version; run pepys-host up <consumer>"
//   VersionClash { consumer: String, version: String }    // one version name, two manifests

// ═════════════════════════════════════════════════════════════════════════════════════════════
// E. The files in the store
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
//   store/
//     host.db                         unchanged: the `versions` table
//     <consumer>/current ->           unchanged
//     <consumer>/<version>/consumer.db, module.wasm        unchanged
//     <consumer>/<version>/version.json                    new: the ConsumerVersion `up` built it from
//
// A consumer file. `offsets`, `change_log` and `applied_facts` are unchanged. The host makes three
// more tables itself, as it makes `applied_facts`, with CREATE TABLE IF NOT EXISTS:
//
//   -- scope mode only: which scope wrote each row
//   CREATE TABLE scope_row (table_name TEXT NOT NULL, key TEXT NOT NULL, scope TEXT NOT NULL,
//                           PRIMARY KEY (table_name, key));
//   CREATE INDEX scope_row_scope_idx ON scope_row (scope);
//
//   -- The HOST makes `link` in every consumer file, with or without a link type, on every open,
//   -- so an `unlink` from a consumer with no link type deletes nothing, as in the test store. The
//   -- API's `link_effective` (file 4) unions the files of the consumers that declare a link type. The generated
//   -- `schema` does not hold it. The host owns two of its columns (`origin`, `scope`) and its
//   -- replace rule, and the schema check then covers only what the consumer declared. The
//   -- columns and their values are the test store's. The test store holds every consumer in one
//   -- database, so its key adds `origin`; a host file holds one consumer, so its key leaves it out.
//   CREATE TABLE IF NOT EXISTS link (type TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL,
//                      scope TEXT,                 -- the scope that wrote it; null in fact mode
//                      origin TEXT NOT NULL,       -- the consumer's name
//                      confidence REAL NOT NULL, evidence TEXT NOT NULL,
//                      PRIMARY KEY (type, from_id, to_id));
//   CREATE INDEX IF NOT EXISTS link_to_id_idx ON link (to_id);   -- `neighbourhood` walks both directions
//   CREATE INDEX link_scope_idx ON link (scope);  -- with scope mode
//
//   -- scope mode only: the fact index, in the scope consumer's own file (fact_index.rs). ONE ROW
//   -- PER FACT ID: a second copy of a fact in the log adds no row; the first copy stays.
//   CREATE TABLE scope_fact (fact_id TEXT NOT NULL PRIMARY KEY, entity TEXT NOT NULL,
//                            at_sort TEXT NOT NULL,      -- sort_key_of(at)
//                            stream TEXT NOT NULL, seq_num INTEGER NOT NULL, body TEXT NOT NULL);
//   CREATE INDEX scope_fact_entity_idx ON scope_fact (entity, at_sort, stream, seq_num);
//
// The index sits in the consumer file, so the batch's transaction covers it: a rollback leaves no
// index row, and the file's own offsets bound every read with no horizon. Each scope consumer
// version stores the bodies of its streams; a fact-mode consumer has no such table.

// ═════════════════════════════════════════════════════════════════════════════════════════════
// F. How it runs
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// ── F1. `pepys-host up [<consumer>]` ───────────────────────────────────────────────────────────
//
// The order is today's `up`. NEW marks what the manifest adds.
//
//   1. NEW  The target: the entry of consumers.json with its module file, whose sha256 must equal
//           the entry's `module`; or, with --version, the version.json and module.wasm of a kept
//           directory in state `previous`. The version's name is `listed.version`.
//           With no consumer name: steps 1 to 5 for each listed consumer whose listed version is
//           not current, one at a time, in file order. The first failure stops the command.
//   2. NEW  VersionClash when store/<consumer>/<version>/version.json exists and differs from the
//           entry: the host trusts `version` as a name, so it refuses two manifests under one.
//           check_table_owners: a table that another consumer's current version owns stops here.
//   3. NEW  Write module.wasm and version.json, then open_version:
//             a. run `manifest.schema` on the new, empty file;
//             b. for each table of `manifest.tables`, read `PRAGMA table_info` (the generated SQL
//                in the repo writes exactly these parts: a type, NOT NULL, PRIMARY KEY): the column names,
//                each declared type against the column's kind (text, entityID, timestamp, json:
//                TEXT; integer, boolean: INTEGER; real: REAL), NOT NULL against `nullable`, and
//                the primary key columns in order;
//             c. the tables in the file, less the host's own, are exactly the keys of `tables`;
//             d. make the host's tables (part E).
//           Any difference is SchemaMismatch, and `up` stops before it reads one fact.
//   4.      Replay beside the live version: catch_up on every stream of `input.streams`, from this
//           file's own offsets. "Caught up": one pass over every stream applied nothing.
//   5.      Take the consumer's writer lock (the live `run` task waits), catch up the last facts,
//           checkpoint, swap `current` in host.db and repoint the link. The live `run` task opens
//           the new directory, with its version.json, on its next pass. No restart.
//
// WHO FILLS THE FACT INDEX DURING `up`: the version's own batches, as they replay from offset 0
// (F3 step 2). Each version has its own `scope_fact`, so `up` needs no running host beside it, and
// a `run` and an `up` never write one index together.
//
// ── F2. `pepys-host run [--up]` ────────────────────────────────────────────────────────────────
//
// Before any task starts:
//   a. read_build_manifest: a bad file stops the host, with the field.
//   b. with --up: the whole of `up` with no name (F1). A failure exits 1 before any fact applies.
//   c. for each listed consumer, read `current/version.json`. None: NoCurrentVersion, exit 1.
//   d. refuse to start when two current versions own one table.
// Then one task per listed consumer, each today's loop: take the writer lock, reconcile `current`,
// open the version when the hash changed, catch up, release, sleep.
//
// DOES `run` BUILD A CONSUMER THAT HAS NO VERSION: plain `run` does not. It runs what `current`
// names and refuses to start when a listed consumer has none. `up` stays the
// one deploy step. `run --up` is that step and then `run`, in one process: it is how a deployment
// whose only entry command is the host gets a first version, and each later one, with no person.
//
// A fact-mode batch (apply_batch): BEGIN IMMEDIATE; for each fact: claim_fact (skip a fact ID that
// `applied_facts` holds), the module, parse_operations (which runs find_link_problem on each link,
// in operation order with the row check), apply; the offset; the change log row; COMMIT. `link`
// upserts on (type, from_id, to_id) with a null scope; `unlink` deletes that row, with no check,
// as the test store does. Any error: ROLLBACK, and the consumer's task stops with the error.
//
// ── F3. One scope batch (scope.rs) ─────────────────────────────────────────────────────────────
//
// A batch is up to 100 records of one stream, as in fact mode.
//   1. BEGIN IMMEDIATE.
//   2. index_facts: INSERT OR IGNORE each fact of the batch into `scope_fact`. The file holds only
//      what its own offsets cover, so every read sees the facts up to this batch and no later.
//   3. The dirty scopes: the entity of each fact of the batch, when it is of `scopeKind`. A sorted
//      set: each scope once, in one order on every replay.
//   4. For each dirty scope: `exports.apply(scope)`. Its one read returns
//        SELECT body FROM scope_fact WHERE entity = ?1 ORDER BY at_sort, stream, seq_num
//      as one JSON list. A read of another scope is ForeignScopeRead: the module traps.
//      The checks of the result run in the order v1-host.md gives; a `delete` or `unlink` is
//      refused.
//   5. replace_scope (F4). 6. The offset of `stream`, and one change log row when a row or link
//      changed. COMMIT. Any error in 2 to 6: ROLLBACK; no index row, no row, no link, no offset;
//      the task stops.
//
// The same fact twice in the log: the index has one row (INSERT OR IGNORE on fact_id; the first
// copy in sequence order stays). The copy marks its scope dirty, the module reads the same facts
// and returns the same result, replace_scope finds no difference, and the batch writes the offset
// alone. No row, no link and no change log row changes.
//
// ── F4. replace_scope ──────────────────────────────────────────────────────────────────────────
//
// A diff, for rows and for links. A delete of every link of the scope and a write of the result
// would write a change for a repeated fact, and would let the later of two scopes take a link.
//   a. Key the result: rows by (table, key_of(row)) after check_row; links by (type, from, to).
//   b. A row or link of the result that ANOTHER scope owns: ScopeConflict; the batch rolls back.
//   c. A row or link of the result that differs from the stored one, or is new: write it, with
//      this scope as its owner (`scope_row`; `link.scope`), `origin` = the consumer's name.
//   d. A row or link the scope owned and did not return: delete it.
//   e. One change entry per written or deleted row or link. The same row or link: no write.
//
// ── F5. find_link_problem ──────────────────────────────────────────────────────────────────────
//
// Before any write of the operation's batch, in both modes. The first problem, in this order:
//   - the type is one of `manifest.links`                       else not-declared
//   - `from`, then `to`, is an entity ID (entity_ids.rs)        else not-an-entity-id
//     and its kind is in the type's list                        else wrong-kind
//   - 0 <= confidence <= 1                                      else bad-confidence
//   - `evidence` is not empty                                   else no-evidence
// It looks no row up: a link to an entity that has not arrived is written as it is.
// One case file, packages/kit/src/links/link-check-cases.json, runs against this and against
// findLinkProblem in TypeScript (file 4).
//
// ── F6. The host's tests ───────────────────────────────────────────────────────────────────────
//
// test_utils.rs gives a stub scope manifest, built from the scope-replace case file's consumer,
// and a ScopeCannedRunner. scope.rs tests a fact twice, a foreign read, a scope conflict and a
// rollback across two scopes; scope_replace.rs runs every case of the shared case file. The Rust
// e2e lane runs the compiled ledger module of the stub deployment through `up` (v1-host.md, "The
// ledger journey").
