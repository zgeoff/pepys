// pepys v1, file 2 of 5: ingest. The receive route, the fact log port, the batch append.
// Usage first, then the types, then the flow. Not compiled or type-checked.
//
// Home file of: FactLog, AppendBatchOutcome, StoredFact, BatchAppender, AppendFailure,
// planAppends, serveIngest. Everything else is imported.

import type { Batch, Deployment, FactEnvelope, ReceivePath, Result, SourceDefinition, StreamName } from './01-kit.ts';
import { expect, test } from 'bun:test';
import { createFactBatchSender } from '@pepys/kit/send';
import { boxxyPlugin, boxxySource } from './01-kit.ts';
import { telemetryPlugin } from './05-telemetry-github.ts';

declare type StreamOffset = number;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Usage
// ═════════════════════════════════════════════════════════════════════════════════════════════

// deployment repo, src/ingest.ts — the ingest process.
// At start, serveIngest:
//   a. checkDeployment; exit 1 on a failure.
//   b. reads every receive path's `check.secretEnv` and every pull path's `env`; exit 1, with
//      every missing name, when one is not set.
//   c. opens the fact log with the streams of every family. The S2 adapter creates the basin and
//      each stream that is missing (create-s2-fact-log.ts does this today), so no setup command
//      creates streams in production.
//   d. mounts one POST route per entry of listReceiveRoutes(deployment), logs the table with
//      each route's `reach`, and starts every pull timer.
//   e. listens on PEPYS_INGEST_HOST (default 127.0.0.1) and PEPYS_INGEST_PORT (default 8080), and
//      passes the host to Bun.serve every time. A deployment that takes the public GitHub route
//      sets the host to the address its network rule reaches.
declare const deployment: Deployment;
await serveIngest({ deployment, environment: process.env });

// packages/ingest/src/receive/receive-route.test.ts (new). One batch and one export go
// THROUGH the route: the real check, the real `read`, the real envelope check, the memory log.
// The test store's `apply` builds envelopes itself and never comes here, so only this test fails when the
// parser refuses a fact ID that a source builds.
test('it stores a fact batch and an OTLP export that come through their routes', async () => {
  const routeLog = createMemoryFactLog(['facts.boxxy.work', 'facts.telemetry.log_record']);

  // `createIngest` is serveIngest without the listener: the routes as one request handler. The
  // test passes the sender proof: the telemetry path needs a proven sender, and with no proof
  // it answers 401.
  const ingest = createIngest({
    deployment: checked({ name: 'stub', plugins: [boxxyPlugin, telemetryPlugin] }),
    secrets: { PEPYS_BOXXY_SIGNING_SECRET: 'sign-me', PEPYS_TELEMETRY_TOKEN: 'let-me-in' },
    log: routeLog,
    senderProof: createFakeSenderProof({ 'token-4': { issuer: 'https://id.example', subject: 'worker-4', name: 'worker four' } }),
    appendRetry: { maxAttempts: 2, retryDelayMs: 0 },
    now: () => 0,
  });

  // the kit's own sender, with its request handed to the route in place of the network
  const send = createFactBatchSender({ source: boxxySource, url: 'http://ingest.test/boxxy/facts', secret: 'sign-me', fetch: ingest.handleRequest });

  // A fact type and IDs that boxxy has. `workFact` is boxxy's test helper: it fills the
  // payload fields the test does not give.
  const sent = await send([workFact('boxxy.attempt.started', 'evt-0001', { attempt: '0193a1b2-0000-7000-8000-0000000000a1', atcSession: 's-9' })]);

  const exported = await ingest.handleRequest(
    new Request('http://ingest.test/v1/logs', { // the standard OTLP path
      method: 'POST',
      // the fake proves the sender that `imp-identity` maps to
      headers: { authorization: 'Bearer let-me-in', 'imp-identity': 'token-4', 'content-type': 'application/json' },
      body: JSON.stringify(oneApiRequestExport), // one claude_code api_request record with request_id req_01
    }),
  );

  const work = await routeLog.read('facts.boxxy.work', 0, 10);
  const records = await routeLog.read('facts.telemetry.log_record', 0, 10);

  expect({
    sent,
    exportStatus: exported.status,
    exportBody: await exported.json(),
    workIDs: work.ok ? work.value.map((item) => item.fact.id) : [],
    recordIDs: records.ok ? records.value.map((item) => item.fact.id) : [],
  }).toStrictEqual({
    sent: { ok: true, value: { stored: 1 } },
    exportStatus: 200,
    exportBody: {},
    workIDs: ['event:boxxy:evt-0001'],
    recordIDs: ['event:telemetry:claude_code.api_request:req_01'],
  });
});

declare const oneApiRequestExport: unknown;
declare function workFact(type: string, event: string, payload: Readonly<Record<string, unknown>>): import('./01-kit.ts').OutgoingFact<typeof boxxySource>;
declare function checked(deployment: Deployment): import('./01-kit.ts').CheckedDeployment; // checkDeployment, and fail the test on a failure
// packages/ingest/src/receive/create-ingest.ts: the routes of a deployment over a given log, with
// no listener. A secret missing from `secrets`, or empty, makes its route refuse every delivery;
// serveIngest exits at start before that can happen.
declare function createIngest(options: {
  deployment: import('./01-kit.ts').CheckedDeployment;
  secrets: Readonly<Record<string, string>>;
  log: FactLog;
  senderProof: import('./01-kit.ts').SenderProof;
  appendRetry: { maxAttempts: number; retryDelayMs: number };
  now: () => number;
}): {
  handleRequest: (request: Request) => Promise<Response>;
  resyncMarks: ResyncMarks;
  // One run of a pull path, with its batch stored. Ingest's own timers call it for each pull path
  // that has an interval; the cursor lives in memory.
  runPull: (source: string, path: 'live' | 'recovery' | 'backfill' | 'resync', cursor: string | null) => Promise<PullRun>;
};
declare type PullRun = { kind: 'stored'; stored: number; cursor: string; isDone: boolean } | { kind: 'not-stored' } | { kind: 'refused'; reason: string } | Exclude<import('./01-kit.ts').Pulled, { kind: 'batch' }>;
declare function createFakeSenderProof(senders: Readonly<Record<string, import('./01-kit.ts').Sender>>): import('./01-kit.ts').SenderProof;

// packages/ingest/src/fact-log/make-batch-appender.test.ts: the memory adapter is the test fake.
const log = createMemoryFactLog(['facts.boxxy.work']);
const append = makeBatchAppender({ log, maxAttempts: 3, retryDelayMs: 0 });

log.loseNextReply(); // the next append is stored whole, and its outcome is reported as unknown
declare const threeFacts: readonly FactEnvelope<unknown>[];
const stored = await append('facts.boxxy.work', threeFacts);
// { ok: true, value: { firstOffset: 0, count: 3 } }: before its second attempt the appender read
// offsets 0 to 2, found the IDs of all three facts in order, and appended nothing. The stream
// holds 3 records.

// The same test file. Another writer takes the offset that
// the lost attempt aimed at, with a copy of the run's FIRST fact only.
const shared = createMemoryFactLog(['facts.github.pull_request']);
const appendShared = makeBatchAppender({ log: shared, maxAttempts: 3, retryDelayMs: 0 });
declare const first: FactEnvelope<unknown>;
declare const second: FactEnvelope<unknown>;

// the next append stores nothing and reports `unknown`; then another writer appends [first] at 0
shared.dropNextAppend({ thenAppend: [first] });
const mended = await appendShared('facts.github.pull_request', [first, second]);
// { ok: true, value: { firstOffset: 1, count: 2 } }. Offset 0 holds the other writer's `first`,
// which is one of two IDs: no full match, so the run was not stored. The appender appended the
// WHOLE run at the new tail. The stream holds [first, first, second]; a consumer drops the copy.
void mended;

// A single fact (a GitHub delivery, one fact of a pull path) is a batch of one.
declare const openedFact: FactEnvelope<unknown>;
await append('facts.github.pull_request', [openedFact]);

void stored;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Types
// ═════════════════════════════════════════════════════════════════════════════════════════════

// ── 1. serveIngest — packages/ingest/src/index.ts ──────────────────────────────────────────────

export declare function serveIngest(options: {
  deployment: Deployment;
  environment: Readonly<Record<string, string | undefined>>;
}): Promise<void>;

// packages/ingest/src/config/read-ingest-config.ts. A missing or empty variable, a secret
// included, is a start failure, and the failure names every one. One listener serves every route,
// the public one included: the rule that lets the public internet in must name the exact path of
// each `reach: 'public'` route.
export interface IngestConfig {
  host: string; // PEPYS_INGEST_HOST, default '127.0.0.1', the API's default too
  port: number; // PEPYS_INGEST_PORT, default 8080
  s2: { endpoint: string; accessToken: string; basin: string };
  // one entry per `secretEnv` and per pull path `env` name, read once
  secrets: Readonly<Record<string, string>>;
}

// ── 2. PORT: the fact log — packages/ingest/src/fact-log/fact-log.ts (changed) ─────────────────
// Two adapters: S2 and memory. The memory adapter is the test fake.

// `append` (one fact) goes. One method means one retry loop and one thing for each adapter to
// implement.
export interface FactLog {
  // Stores every fact, in order, in ONE append guarded by `expectedTail` (S2 `matchSeqNum`: the
  // offset the first record must get). All the facts land or none does.
  appendBatch: (stream: StreamName, facts: readonly FactEnvelope<unknown>[], expectedTail: StreamOffset) => Promise<AppendBatchOutcome>;
  read: (stream: StreamName, from: StreamOffset, count: number) => Promise<Result<readonly StoredFact[], { reason: 'unknown-stream' }>>;
  readTail: (stream: StreamName) => Promise<Result<StreamOffset, { reason: 'unknown-stream' }>>;
}

export type AppendBatchOutcome =
  // fact `i` of the batch has the offset `firstOffset + i`
  | { kind: 'acknowledged'; firstOffset: StreamOffset; count: number }
  // Nothing was stored.
  //   tail-mismatch     another append moved the tail            -> read the tail, append again
  //   unknown-stream    the stream does not exist                -> stop; a fault of the deployment
  //   too-large         empty, over 1000 records, or over 1 MiB  -> stop; a fault of the caller
  | { kind: 'rejected'; reason: 'tail-mismatch' | 'unknown-stream' | 'too-large' }
  //   invalid-envelope  fact `index` is not a valid envelope     -> stop; a fault of the caller
  | { kind: 'rejected'; reason: 'invalid-envelope'; index: number }
  // The reply was lost: the batch is stored whole, or not at all.
  | { kind: 'unknown' };

// all the facts of one append have one `appendedAtMs` (s2-lite stamps the append)
export interface StoredFact {
  offset: StreamOffset;
  fact: FactEnvelope<unknown>;
  body: string;
  appendedAtMs: number;
}

// The limits of one S2 append (measured against s2-lite 0.43.2). A record meters as its
// stored body in UTF-8 bytes plus 8; pepys records have no headers.
export declare const appendLimits: { readonly records: 1000; readonly meteredBytes: 1_048_576 };

// packages/ingest/src/fact-log/plan-appends.ts (new, pure).
// Cuts the facts of ONE stream, in order, into runs that each stay inside `appendLimits`: a run
// closes when the next fact would make it 1001 records or more than 1,048,576 metered bytes.
// `too-large`: fact `index` alone meters more than one append takes; no run can hold it.
// Both adapters call the same metering function in `appendBatch`, so the memory adapter refuses
// what s2-lite refuses. The S2 adapter meters before `AppendInput.create`, which throws.
export declare function planAppends(
  facts: readonly FactEnvelope<unknown>[],
): Result<readonly (readonly FactEnvelope<unknown>[])[], { reason: 'too-large'; index: number }>;

export declare function createS2FactLog(parameters: { endpoint: string; accessToken: string; basin: string; streams: readonly StreamName[] }): Promise<FactLog>;

export interface MemoryFactLog extends FactLog {
  // the next append is stored whole, and its outcome is reported as unknown
  loseNextReply: () => void;
  // The next append is NOT stored and its outcome is reported as unknown; then
  // `thenAppend` is stored at the tail, as a second writer on the stream would store it
  dropNextAppend: (other: { thenAppend: readonly FactEnvelope<unknown>[] }) => void;
  // The next append reports `unknown` and is not stored yet. It is stored, whole, just
  // before the append after it is checked, so that one gets `tail-mismatch`.
  landNextAppendLate: () => void;
}

export declare function createMemoryFactLog(streams: readonly StreamName[]): MemoryFactLog;

// The fixtures of packages/ingest/src/fact-log/fixtures/ run against both adapters, and against the
// Rust host's log, which has the same one append. The append fixtures are append-batch-*:
// acknowledged, at-expected-tail, behind-tail, multiple, unknown-stream, invalid-envelope (index 1
// of 3; tail unchanged), limit-records (1000 acknowledged, 1001 refused) and too-large (an empty
// list; 2 records over 1 MiB together). A fixture list item may be a wrapper that repeats a fact
// or pads its payload, so a list over a limit needs no large file. One function, checkAppendBatch,
// holds the checks and the metering that both adapters run before they reach a stream.

// packages/ingest/src/fact-log/make-batch-appender.ts (replaces make-fact-appender.ts). Not a
// port: one function over the port. It owns the retries of ONE append.
export type AppendFailure =
  // the log gave a reason that no retry changes
  | { kind: 'refused'; reason: 'unknown-stream' | 'invalid-envelope' | 'too-large' }
  // no acknowledgement after `attempts` attempts; the facts may or may not be in the log
  | { kind: 'not-stored'; attempts: number };

export type BatchAppender = (
  stream: StreamName,
  facts: readonly FactEnvelope<unknown>[],
) => Promise<Result<{ firstOffset: StreamOffset; count: number }, AppendFailure>>;

export declare function makeBatchAppender(options: { log: FactLog; maxAttempts: number; retryDelayMs: number }): BatchAppender;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Flow
// ═════════════════════════════════════════════════════════════════════════════════════════════

// ── 3. One delivery — packages/ingest/src/receive/handle-receive-route.ts (new) ────────────────

interface ReceiveDependencies {
  secret: string; // the value of `path.check.secretEnv`; an empty one passes no delivery
  append: BatchAppender;
  // One chain of turns per stream, for the whole process. A delivery holds a stream's turn for
  // ALL of its runs on that stream, so the runs of two deliveries never interleave. Streams do
  // not wait for each other.
  turns: Map<StreamName, Promise<void>>;
  // The bodies THIS ROUTE stored in the last hour, by the SHA-256 of the body as sent, with the
  // proven sender's issuer and subject in the key on a path with `sender`: a body stored on one
  // route, or from one sender, never answers for another. 10,000 entries at most, the oldest
  // dropped first. In memory only.
  recentBodies: Map<string, { stored: number; at: number; entities: readonly EntityID[] }>;
  senderProof: SenderProof; // the port; the handler calls no verifier
  // Per entity, the last body this process stored for it and that fact's `at`; and the entities
  // that the source's `resync` pull must read again. Kept only for a source with a `resync` pull,
  // 10,000 entries each at most, in memory.
  lastBodies: Map<EntityID, { digest: string; at: string; locator: string | undefined }>;
  resyncMarks: Map<EntityID, string | undefined>; // each mark with the locator of its last fact
}

// What a resync pull reads (createIngest returns it). `runPull` gives the pull the source's marks,
// and removes every one of them once the run's whole batch is stored, so a failed run keeps them.
interface ResyncMarks {
  list: (source: string) => readonly { entity: EntityID; locator: string | undefined }[];
  remove: (source: string, entity: EntityID) => void;
}

// A route of `path.ignoredRoutes` runs steps a to c1 of the path, then answers as an ignored
// delivery: no read, no append.

// The order. Each step answers and stops, or goes on.
export function handleReceiveRoute(source: SourceDefinition, path: ReceivePath, dependencies: ReceiveDependencies): (request: Request) => Promise<Response> {
  const byteLimit = path.bodyByteLimit ?? 1_048_576;
  const factLimit = path.factLimit ?? 100;

  return async (request) => {
    // a. 405 unless POST.
    if (request.method !== 'POST') {
      return fail(405, 'method not allowed');
    }

    // b. 413 when the body as sent is over `bodyByteLimit`: first by `content-length`, before any
    //    read, then by the count while reading, which cancels the stream at the limit.
    const sent = await readBodyUpTo(request, byteLimit);

    if (sent === 'too-large') {
      return fail(413, 'body too large');
    }

    // c. 401 unless the check passes, on the bytes AS SENT (GitHub signs what it sends; a token
    //    check reads no body). No code of the source has seen the delivery yet. The check is the
    //    kit's `isDeliveryAuthentic`, the one function that `@pepys/kit/send` is tested against.
    if (!isDeliveryAuthentic(path.check, dependencies.secret, request.headers, sent)) {
      return fail(401, 'not authorised');
    }

    // c1. A path with `sender` (file 1): 401 unless
    //    the `SenderProof` port proves one. The proven sender goes to `read` as
    //    `Delivery.sender` (step e). The handler calls the port and no verifier.
    const sender = path.sender === undefined ? undefined : await dependencies.senderProof.prove(path.sender, request.headers);

    if (sender === null) {
      return fail(401, 'not authorised');
    }

    // c2. A body that this process already stored whole. Its SHA-256 is in
    //    `recentBodies`: answer as the first time (`stored`, the same count) and append nothing.
    //    Step h adds a body only after `stored`, so a delivery that got 503 is never dropped.
    //    This bounds what a replay adds to the log; it is not what keeps the rows right (see "A
    //    replayed delivery" below).
    const digest = await hashBody(sent);
    const known = dependencies.recentBodies.get(sender === undefined ? digest : JSON.stringify([digest, sender.issuer, sender.subject]));

    if (known !== undefined) {
      // A copy of an earlier body. When ANOTHER body for one of its
      // entities was stored after it, the copy may be a true return to the earlier state (A,
      // B, A). The copy is still dropped; the entity is marked for the resync pull.
      for (const entity of known.entities) {
        if (dependencies.lastBodies.get(entity)?.digest !== digest) {
          dependencies.resyncMarks.set(entity, dependencies.lastBodies.get(entity)?.locator);
        }
      }

      return succeed(path, 'stored', known.stored);
    }

    // d. Decoding. No `content-encoding`: the bytes as sent. `gzip`, when the path
    //    lists it: gunzip as a stream that stops at `bodyByteLimit` decoded bytes (413), so a
    //    small body cannot unpack to a large one. Any other value, or `gzip` on a path that does
    //    not list it: 415. A gzip body that does not gunzip: 400. Bun's DecompressionStream gives
    //    64 KiB chunks and stops when the reader cancels (a test covers it).
    const body = await decodeBody(sent, request.headers.get('content-encoding'), path.encodings ?? [], byteLimit);

    if (typeof body === 'string') {
      return body === 'unsupported' ? fail(415, 'content encoding not accepted') : body === 'too-large' ? fail(413, 'body too large') : fail(400, 'the body does not decode');
    }

    // e. The source's own code, pure. A read that throws is a fault of the deployment: 500.
    // `sender` goes to `read`: a reader that copies the sender into its facts (telemetry) needs
    // it on every export.
    const received = path.read({ headers: request.headers, body, ...(sender === undefined ? {} : { sender }) }, source);

    if (received.kind === 'refused') {
      return fail(received.status, received.reason);
    }

    if (received.kind === 'ignored' || received.batch.facts.length === 0) {
      return succeed(path, 'ignored', 0);
    }

    // f. 413 when the batch holds more facts than the path's `factLimit`.
    if (received.batch.facts.length > factLimit) {
      return fail(413, `a batch holds ${factLimit} facts at most`);
    }

    // g. Every fact is checked before any is written: the envelope, and that a family of this
    //    source owns the stream (422). Then the plan: one list of runs per stream. A fact that
    //    no append can hold refuses the WHOLE batch with 413, so content never stores a part.
    const problem = findBatchProblem(source, received.batch);
    const plan = problem === undefined ? planBatch(received.batch) : undefined;

    if (plan === undefined || !plan.ok) {
      return problem === undefined ? fail(413, 'one fact is larger than the log takes') : fail(422, problem);
    }

    // h. The appends. No v1 source reads a blob, so v1 ingest has no blob store, and a fact with a
    //    blob gets 500 before any append. A deployment with such a source adds the store here,
    //    before the appends (a blob is named by its content, so a repeat is harmless).
    if (received.batch.facts.some((pending) => pending.blobs.length > 0)) {
      return fail(500, 'ingest has no blob store');
    }

    const outcome = await storeBatch(plan.value, dependencies);

    if (outcome === 'stored') {
      rememberBody(dependencies.recentBodies, digest, received.batch.facts);
      markTies(dependencies, digest, received.batch.facts);

      // The one success answer for a batch with facts: every run of every stream is acknowledged,
      // and s2-lite acknowledges an append only when it is durable in the bucket.
      return succeed(path, 'stored', received.batch.facts.length);
    }

    // i. A partial failure. See the table below.
    return outcome === 'refused'
      ? fail(500, 'the log refused the batch')
      : new Response(JSON.stringify({ error: 'the batch is not stored, send it again' }), { status: 503, headers: { 'retry-after': '1' } });
  };
}

// The streams append at the same time; the runs of one stream append one after the other. A run
// starts only when the run before it on its stream is acknowledged. Every stream settles before
// the answer: a failure on one stream never leaves another stream's append in flight. `takeTurn`
// turns a throw in its work into `refused` and gives the turn back in `finally`, so a throw on one
// stream neither rejects the `Promise.all` early nor holds the stream's turn.
async function storeBatch(plan: ReadonlyMap<StreamName, readonly (readonly FactEnvelope<unknown>[])[]>, dependencies: ReceiveDependencies): Promise<'stored' | 'refused' | 'not-stored'> {
  const settled = await Promise.all(
    [...plan].map(([stream, runs]) =>
      takeTurn(stream, dependencies, async () => {
        for (const run of runs) {
          const appended = await dependencies.append(stream, run);

          if (!appended.ok) {
            return appended.failure.kind; // the later runs of this stream are not sent
          }
        }

        return 'stored' as const;
      }),
    ),
  );

  // `refused` wins over `not-stored`: a repeat cannot mend it, so the sender must not be told to repeat.
  return settled.includes('refused') ? 'refused' : settled.includes('not-stored') ? 'not-stored' : 'stored';
}

// What the log holds, and what ingest answers. "Whole" and "none" are per append; a stream whose
// facts need one run (1000 records and 1 MiB or less) is therefore whole or none itself.
//
//   case                                        the log holds                         answer
//   every run acknowledged                      every fact                            200
//   one fact too large for any append           nothing (found in step g)             413
//   a run has no acknowledgement after          that stream: the runs before it, and  503, retry-after: 1
//     `maxAttempts` (`not-stored`)                maybe that run, whole; no later run
//                                               other streams: whatever they stored
//   the log gives a definite refusal            the runs before it on that stream;    500, and ingest
//     (`refused`: unknown-stream; or a second     other streams: whatever they stored   logs the reason
//     line of defence for a bad envelope or
//     size, which step g already refused)
//   the adapter throws (a bad access token)     as the line above                     500
//
// 503 means "send the same delivery again, unchanged": the sender of a fact batch, GitHub's
// redelivery and an OTLP exporter all do that. The facts that landed land again as copies, and
// each consumer drops a copy by its fact ID (file 3). 200 is never sent for a part.
// 500 is a fault of the deployment, not of the sender: a repeat gets 500 until it is mended. The
// kit's fact batch sender treats every 5xx as `retry` and keeps the batch. An OTLP exporter drops
// an export on 500; the GitHub recovery pull path fetches a delivery again.
// The answer shape of a success is the path's `answer` (file 1). Every failure body is
// `{"error": "<reason>"}` for every path.
//
// A replayed delivery. Neither check signs a time, so a signed body that
// someone captured passes step c again, at any later time. What a replay can change:
//   - A row or a link: NO. A replay carries the fact IDs of the first delivery, because every
//     fact ID comes from the signed body alone: boxxy's `event` values are in the body, a
//     telemetry ID is a hash of the record, and a GitHub ID is a hash of the body (file 5; the
//     `x-github-delivery` header is not signed, so it decides no ID). A fact-mode consumer skips a fact
//     ID that `applied_facts` holds (file 3, F2). A scope consumer's index holds one row per
//     fact ID, and the first copy in sequence order stays (file 3, F3). So the copy changes
//     nothing, in any order and at any time.
//   - The log: it grows by one copy per replay that step c2 does not catch (after a restart,
//     after one hour, or on another replica). Ingest keeps no durable list of fact IDs, and v1
//     adds none: it would be a second store that every append must write, to save log space
//     only. The route for boxxy batches is cluster only. The GitHub route is public, so a
//     holder of one signed body can add copies at the rate ingest answers; the size limit and
//     the hour of step c2 are the bound.
//   - "pepys must not accept a batch twice" is therefore met for rows and links, and not met in
//     the literal sense: ingest answers 200 to a replay. A signed time (a third check kind)
//     would refuse it; GitHub's scheme has none to check.
// Ingest proves the sender of a fact batch path with the path's HMAC secret, one secret per
// route: a body that passes step c came from a holder of that secret. On a path that needs a
// sender, ingest also proves the sender through `SenderProof` (step c1), and refuses with 401
// when the port proves none.
declare function hashBody(sent: Uint8Array): Promise<string>;
declare function rememberBody(recent: ReceiveDependencies['recentBodies'], digest: string, facts: readonly FactEnvelope<unknown>[]): void;
// For each fact of a NEW body, when the entity's last stored body has
// the same `at` and another digest, two bodies tie: mark the entity. Then set `lastBodies`.
// Only a source with a `resync` pull has its marks read; for any other source this is a no-op.
declare function markTies(dependencies: Pick<ReceiveDependencies, 'lastBodies' | 'resyncMarks'>, digest: string, facts: readonly FactEnvelope<unknown>[]): void;

// ── 4. One append with its retries — make-batch-appender.ts ────────────────────────────────────
//
//   outcome                    stored?    the appender does
//   acknowledged               all        returns ok
//   rejected tail-mismatch     none       first settles a pending attempt at that tail
//                                         (below); then reads the tail, appends again at the new tail
//   unknown                    all|none   settles THAT attempt (below), then returns ok or appends again
//   rejected, any other        none       returns `refused`, no retry
//   out of attempts            all|none   returns `not-stored`
// The guard (`expectedTail`) is on every attempt, the first included.
//
// Settling an attempt whose outcome is `unknown`. The attempt sent n facts with
// `expectedTail` = t. The guard lets that append land in one place only: whole, at offsets
// t to t + n - 1. So the appender reads exactly `read(stream, t, n)` and compares the n fact IDs
// with the run's n fact IDs, in order. A search for the first fact's ID alone, anywhere after the
// first attempt's tail, would take another writer's copy of the first fact for the whole run.
//
//   what offsets [t, t + n) hold              it means                               the appender does
//   n records, every ID equal, in order       the attempt landed                     returns ok, firstOffset t
//   no record (the tail is still t)           the attempt has not landed. It may     appends again with expectedTail t.
//                                             still be in flight.                    The guard lets one of the two land.
//   fewer than n records, or n records with   another writer took offset t. The      reads the tail, appends the WHOLE
//   one ID or more that differs. This         attempt cannot land now or later:      run again at the new tail
//   covers a partial match: a prefix of the   its guard fails for good.
//   run's IDs, or the first ID alone.
//
// Why a partial match is never "our run, in part": one append is whole (measured on s2-lite), so a
// match of fewer than n IDs at [t, t + n) is another writer's records. Two writers on one stream
// are normal: a pull path and a receive route in one process, or two ingest processes in a
// rolling deploy. The turns of part 3 order the receive routes of one process only.
// What the third row costs: a fact of the run that the other writer also stored is in the log
// twice. Each consumer drops the copy by its fact ID. No fact of the run is lost, and ok is
// returned only after an acknowledgement or a full match.
// Which attempts can still be unsettled: not the latest one alone. The second row does not
// settle an attempt: it sends a new
// one at the same t while the old one may still be in flight. So several attempts can be
// pending at one t, and any one of them can land late.
//   - The appender keeps `pending`: the t of the attempts whose outcome was `unknown` and that
//     the third row has not ruled out. All of them have the same t: a new t is taken only after
//     the third row, which rules every attempt at the old t out for good.
//   - While `pending` is set, EVERY later outcome at that t is followed by the compare of
//     [t, t + n) before any new append: an `unknown`, and also a `tail-mismatch`. A
//     `tail-mismatch` at t says only that some record is at t now. It may be this run, stored by
//     the late attempt. A full match: return ok with firstOffset t, and append nothing. No full
//     match: the third row; clear `pending`; append at the new tail.
//   - An `acknowledged` attempt at t needs no compare: the guard let exactly one of them land.
// Without this, the case "attempt A is unknown, the read finds nothing, attempt B goes out at t,
// A lands, B gets tail-mismatch" would store the whole run twice (up to 1000 copies). The memory log
// plays it with `landNextAppendLate`, and the stream then holds n records, not 2n.
// The check costs one read of n records (1000 at most) per `unknown` outcome.
//
// The S2 adapter's `appendBatch`: meter (a refusal makes no request); `AppendInput.create(records,
// { matchSeqNum: expectedTail })`; `append` on the client with `retry: { maxAttempts: 1 }`; the
// ack gives `firstOffset = ack.start.seqNum`, `count = ack.end.seqNum - ack.start.seqNum`; an
// error goes through findAppendOutcome, unchanged (412 is tail-mismatch, a missing stream is
// unknown-stream, another definite server refusal throws, anything else is `unknown`).

// ── Everything below decides no order. ────────────────────────────────────────────────────────

declare function readBodyUpTo(request: Request, limit: number): Promise<Uint8Array | 'too-large'>;
// The kit's check. 'hmac-sha256': `sha256=<hex>` over the body as sent. 'token': the secret, or
// `Bearer <secret>`. Constant time; an empty secret passes nothing.
declare function isDeliveryAuthentic(check: ReceivePath['check'], secret: string, headers: Headers, sent: Uint8Array): boolean;
declare function decodeBody(sent: Uint8Array, encoding: string | null, accepted: readonly 'gzip'[], limit: number): Promise<Uint8Array | 'unsupported' | 'too-large' | 'corrupt'>;
declare function findBatchProblem(source: SourceDefinition, batch: Batch): string | undefined;
// groups the facts by stream, in batch order, and calls planAppends for each stream
declare function planBatch(batch: Batch): Result<ReadonlyMap<StreamName, readonly (readonly FactEnvelope<unknown>[])[]>, { reason: 'too-large' }>;
declare function takeTurn<Value>(stream: StreamName, dependencies: ReceiveDependencies, work: () => Promise<Value>): Promise<Value | 'refused'>;
declare function fail(status: number, reason: string): Response;
// 'status': 200 {"status":"stored","stored":n} or 202 {"status":"ignored"}. 'empty': 200 {} for both.
declare function succeed(path: ReceivePath, outcome: 'stored' | 'ignored', count: number): Response;
