# Open for the builder

This doc lists what the builder of [pepys v1](./v1.md) must settle. No sketch was compiled or
type-checked. Two trial runs tested the riskiest parts: one ran a real compiled module through the
real Rust host, and one compiled the real `boxxy_work` entry file with scriptc. The host run's code
is on the branch `spike/v1-host-scope`, as reference code: read it, and do not merge it. The scriptc
run's code is not in this repo. This doc states what each run built and found. The other sections
list the gaps inside the sketches, and every item that the sketches mark as assumed, not checked or
not designed. Where a finding here contradicts a sketch, write the code by the finding.

## The host

The run used the host at the state of this repo before any v1 work, with wasmtime 50.0.1 and Turso
0.8.3. It added about 1,250 lines to `crates/host/src`, ran the compiled `boxxy_work` module on 9
fact files, from a fact log through the fact index, the module, the link check and the scope replace
into a store, and got the expected rows and links in every table of every file. The fact-mode path
did not change. What the host needed:

| Part          | Lines | Holds                                                                                          |
| ------------- | ----- | ---------------------------------------------------------------------------------------------- |
| scope         | 415   | the scope runner and fact source, the parse of the wire, the scope batch, the scope replace    |
| rows          | 255   | a row as a JSON object: the check against a manifest table, the key, load, write and delete    |
| fact index    | 166   | the index file with its two tables, the indexing, the read of one entity's facts, the sort key |
| links         | 156   | the link, the kind of an ID, the link check, load, write and delete                            |
| manifest      | 102   | the serde types of a consumer manifest, with none of the load rules                            |
| module runner | +99   | linking by the manifest's symbols; the scope read reuses the two host functions of a row read  |
| store, errors | +47   | the `scope_row` and `link` tables, and five error variants                                     |

The run wrote the manifest and its SQL by hand, and `pepys build` made neither. Turso took all of
the design's SQL, and serde parsed the manifest with unknown fields refused.

The sketch does not match the real host in 6 places. The first 4 change what the builder writes:

1. **The fact source needs a multi-thread runtime.** The module calls the read from inside a
   synchronous wasm call, and the index read is async. The fix is the one that the row read uses:
   block in place on the runtime's handle. A test on a current-thread runtime panics there, so every
   host test that runs a real read needs the multi-thread flavour.
2. **The fact source must own what it reads from.** A read that borrows the index cannot serve the
   module. The run added a read that takes a connection, and cloned the index's connection.
3. **A stored number is not the wire's number.** A confidence is `1` on the wire and `1.0` from a
   REAL column, and the two JSON values are not equal. The scope replace must compare a link's
   confidence, and each REAL column of a row, as floats. Otherwise a replay writes each link again.
4. **The repo's log port refused a pushed fact,** with the ID `event:boxxy:…`. Slice 1 made the
   envelope change in [01-kit.ts](./v1/sketches/01-kit.ts): the kit's envelope parser and the Rust
   host's envelope check both accept `event:<source>:<event ID>`.
5. The fact index holds an open store, where the sketch has a path. The host now keeps the index in
   each scope consumer's file, inside the batch's transaction, so a rolled-back batch leaves no
   index row and the read needs no horizon.
6. The scope read returns bytes and never returns `-1`, so its adapter over the row read is a few
   lines.

The [scope replace case file](./v1-host.md#the-scope-replace-case-file) is the rule for duplicate
keys, a link stored with no scope, change entries, integer columns and a refused link. The trial run
held the key of a link's change entry as a JSON list, and the case file, which wins, holds JSON
text.

The sketch leaves the meanings below open, and the trial run picked one for each:

- The scope read returns the stored bodies joined as text, with no parse.
- The checks of one scope run before that scope's writes. The sketch puts the check before any write
  of the batch. With two dirty scopes the first scope's rows are written and rolled back, and the
  result is the same.

The host's tests now check a read of another scope, two dirty scopes through the compiled ledger
module, the S2 log, and the sort key on times with different fraction lengths. No run has checked:

- a scope consumer with two streams;
- a batch above 100 records, a scope above 60 facts, and speed;
- two host processes on one store. The writer lock's own tests take it twice in one process.

## scriptc

The run used scriptc 0.4.5 and zig 0.16.0. The real `boxxy_work` entry file compiled to a module of
611,086 bytes, every statement static, attested deterministic, with no forbidden import. scriptc
refused no construct. The glue had 26 union members and 213 decoders, with nested objects, lists,
optional and nullable fields, literal unions and `unknown` fields, so the
[typing rules of the glue](./v1/sketches/03-manifest-host.ts) hold for those. The module gave the
same output as a Bun run of the same code on all 9 fact files, and applied one scope of 60 facts in
0.38 ms at the median.

The entry file needed 5 rewrites:

1. A pull request ID typed as a number, where the fact holds decimal text. The glue types it as
   text.
2. An object that reads its own earlier value while it is assigned, which TypeScript narrows to
   `never`. A helper function that merges the two values compiles.
3. An unused type import.
4. No model contract. scriptc attests only a library that exports a model type, a message type,
   `init` and `update` ([consumers](./pepys/consumers.md#compiler)). The glue writes the two types
   and the two functions, and the entry file declares `init` and `update` that call them: scriptc
   takes a re-exported type but refuses a re-exported function. The message union needs two or more
   members.
5. A result that depended on the order of two facts with one time. The fix keeps the smaller fact ID
   on an equal time. A consumer author must break every tie of time by fact ID. One arrival order
   cannot show a missing tie-break, so a test calls `applyInBothOrders` from `@pepys/testing`.

A pull request ID above the 32-bit range came through as the right text, sent as text and sent as a
JSON number. The run did not check the two queries, a read of another scope, a scope above 60 facts,
or the kit's own glue generator: the run's generator was its own. A later build of the GitHub pull
request consumer with the kit's generator compiled, and so did a scope glue that covers every typing
rule. That build found that scriptc refuses an ID brand whose tag is a type parameter, so the glue
brands every ID with a fixed tag and adds the kind as a second tag.

## Not designed

- The tables of the issue and review families.
- The mapping from a bumped package to a deploy target.
- A signed time in a delivery check. A third check kind would add it, and the senders of the two
  kinds in v1 would not change.
- A public route to the API's MCP endpoint, with OAuth on the route. The API checks no caller in v1,
  so a deployment keeps it off every public route and a client reaches it through a port-forward.

## Assumed

- An agent's own session ID never equals the atc session ID of another session.
- One fact ID belongs to one stream.
- The body that GitHub's deliveries API returns parses to the same JSON value as the body it sent.
- GitHub lists an App's webhook deliveries newest first, and gives each delivery's body as a JSON
  object in `request.payload`. The tests run the pulls against a mock of the API, and no test calls
  the live API.
- The GitHub App's token may read a pull request and a release.

## Not checked

Telemetry:

- That Codex honours `OTEL_RESOURCE_ATTRIBUTES`. If it does not, a Codex record has no atc session
  ID, and its session is the Codex conversation ID.
- That Codex sends a turn cost with an estimate for every kind of account, and that the record
  carries a model. The model column is nullable for that reason.
- Claude Code's OTLP shape on the wire: the scope name, and numbers as numbers or as text.
- Either exporter's batch size, and whether either one sends gzip.
- That an OTLP exporter retries on 503 and stops on 500, as the OTLP specification requires.
- The attribute that holds the subagent of a request. Until it is known, the `agent` column of a
  model request is null.

GitHub:

- That the App gets a push webhook for a tag that a workflow moves with the workflow's own token. If
  it does not, the deploy rule falls back to the status rows with no change.
- The update time that GitHub puts in a delivery for a deleted release. The tombstone rule does not
  rest on it.
- That the pull request consumer reads release bump rows from a payload that the real host stored.
  The e2e lane reads the stored row back through the host, with no release URL in its payload.

The build and the host:

- A crash of s2-lite in the middle of a batch write.

## Known limits

- **A telemetry record under another sender's session is stored.** The readers drop it
  ([telemetry](./v1-plug-ins.md#telemetry)). A query that reads the telemetry tables without the
  join to the session's owner would show it. The sender also writes the time of a record, so a
  worker can move its own cost between its own attempts. Sessions on one machine are one sender. A
  session that can prove no sender cannot send telemetry at all.
- **The telemetry route refuses every export until its trust documents and audience are set.** The
  cost of every attempt then reads as none. Ingest starts without them, so a deployment notices only
  from the 401 answers.
- **A replay of a signed delivery grows the log.** It changes no row and no link. Past the hour of
  the drop, after a restart, or on another replica, each replay adds one copy of its facts. The
  GitHub route is public, so the size limit and that hour are the bound.
- **The resync marks are in ingest's memory.** A restart before the pull runs loses them, and the
  row stays at the older state until the next delivery for the object.
- **One fact ID can have two sessions.** The fact ID leaves the OTLP resource out, and the session
  comes from the resource first. When a sink rewrites the resource between two copies of one record,
  the first copy in the log wins.
- **Each scope consumer version stores the facts of its streams.** Two scope consumers of one stream
  hold two copies of its bodies, and a new version indexes its streams again as it replays.
- **The host sorts the keys of a stored JSON object.** JavaScript keeps them in the order written,
  so the text of a JSON object in a JSON column can differ from the test store's. The value is the
  same, and the host's own compares and deletes use the sorted text on both sides. A table whose
  primary key is a JSON object gets a key text that a TypeScript reader does not compute.
- **A long scope is computed many times.** A scope with N facts is computed again in every batch
  that holds one of its facts.
- **One failed `up` stops `run --up`.** Every consumer's tables then go stale until it is mended.
  Ingest keeps storing facts. A scope conflict stops its consumer until a new module is up.
- **Each table is described twice in `consumers.json`,** as columns and as SQL. The check at open
  holds the two together.
- **One call reads each consumer file at its own instant.** The host commits each consumer's batch
  in its own file, so a join across two files can see one file's newer batch beside the other's
  older one.
- **`neighbourhood` shows no release and no deploy,** and never resolves a session. A repository and
  a user are in column values and are kinds of no plug-in, so `get_entity` finds neither.
- **The delivery tie has three known gaps.** A bump in two steps reports the deploy early. A
  repository with several release components gets the first release of any of them. A repository
  that deploys itself with no bump pull request gets no deploy time.
- **The deployed bucket has no backup.** Garage holds the fact log and the blobs on one volume. The
  loss of that volume loses every fact, and the host can then rebuild no table.
- **A process on the cluster's node reaches every private route.** The cluster admits the node's own
  addresses before any network rule, so a private route is closed to other pods only. The check of
  each route still holds: a fact batch needs its signing secret, and a telemetry export needs a
  proven sender.
- **Storing every log record costs log space.** Tool and hook events outnumber model requests.
