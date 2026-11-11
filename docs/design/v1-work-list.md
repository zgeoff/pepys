# The v1 work list

This list is the build of [pepys v1](./v1.md), as numbered slices in dependency order. Each slice
gives its outcome, the sketch it follows, the slices it needs first, and the check that proves it.
Build a slice only when the slices it needs are on `main` with their checks green. `@pepys/kit` and
`@pepys/testing` reach npm in slice 4, as early as the order allows, because a plug-in in another
repo waits for them. Read [Open for the builder](./v1-open.md) before a slice: it holds what two
trial runs found and what no run has checked. In each slice, rewrite the docs that its code makes
false, `AGENTS.md` included.

The sketches are [01-kit.ts](./v1/sketches/01-kit.ts),
[02-ingest-log.ts](./v1/sketches/02-ingest-log.ts),
[03-manifest-host.ts](./v1/sketches/03-manifest-host.ts),
[04-store-api.ts](./v1/sketches/04-store-api.ts) and
[05-telemetry-github.ts](./v1/sketches/05-telemetry-github.ts). A slice refers to them by number.

## 1. The kit's declarations and the envelope

- **Outcome:** `@pepys/kit` holds every declaration type and its `define` function, the deployment
  check, and the envelope and ID parsers, which move from `@pepys/schema`. A fact ID may be
  `event:<source>:<event ID>`, in TypeScript and in the Rust host. A pull request is
  `github:pull_request` in the existing consumer, fact builder, case file and tests. A lint rule
  keeps each core package to the named core packages.
- **Sketch:** 01, the opening of the types, and parts A to C, E to G.
- **Needs first:** nothing.
- **Check:** a table test gives each failure kind of the deployment check one case. The shared
  envelope case file, with its eight added cases, passes in `bun test` and in `cargo nextest run`.
  The existing e2e lane passes with the renamed kind. An import of a source package from a core
  package fails `bun run lint`.

## 2. The generators, the link check and the sender

- **Outcome:** the kit writes the SQL schema and the boundary glue of a consumer, settings constant
  included. It holds the pure link check with its case file, the store reader port's types, and
  `@pepys/kit/send`.
- **Sketch:** 01, parts D and H; 03, part C; 04, parts 1 and 2.
- **Needs first:** slice 1.
- **Check:** a generator test covers each row of the glue's typing table, and the generated reader
  uses an index loop. The link case file passes. A batch that the sender signs passes the HMAC check
  that ingest uses, and the sender maps a 5xx answer to a retry and a 4xx answer to a refusal.

## 3. The testing package

- **Outcome:** `@pepys/testing` gives a plug-in author the test store and the memory store reader. A
  consumer and a query run under `bun test` with no host and no scriptc.
- **Sketch:** 01, part H; 04, part 1.
- **Needs first:** slice 2.
- **Check:** a test applies the facts of a stub scope consumer twice and in two orders, and reads
  equal rows and links. A fact ID that the envelope parser refuses fails the apply. A link of a
  wrong kind fails as the host's check would.

## 4. Publish the kit and the testing package

- **Outcome:** `@pepys/kit`, `@pepys/testing` and `@pepys/kysely-turso` are on npm, and CI publishes
  each later version. The rule in `AGENTS.md` that every package is private changes here.
- **Sketch:** 01, the package list above part A.
- **Needs first:** slice 3. The first publish of each package needs the owner (the `npm-publish`
  skill has the steps).
- **Check:** a package in an empty folder outside this repo installs the three from npm, declares a
  stub plug-in that type-checks, and passes a query test on seeded rows of the test store.

## 5. The glue step of `pepys build`

- **Outcome:** `@pepys/cli` is on npm with `pepys build`, which checks a deployment or a plug-in and
  writes the glue of each consumer. `--check` exits 1 on a stale glue file. A plug-in author needs
  this step to write an entry file and to test a consumer.
- **Sketch:** 01, part H, steps 1 and 2.
- **Needs first:** slices 2 and 4.
- **Check:** the command writes the glue of a stub plug-in, a second run changes no file, and
  `--check` fails after a table gains a column. The outside package of slice 4 runs the published
  command and passes a consumer test on the test store.

## 6. Ingest: the log port and one append

- **Outcome:** the fact log port has one write, a guarded append of a list. Ingest cuts a stream's
  facts by the log's limits, and one function owns the retries of one append. The memory log can
  lose a reply, drop an append, and land an append late.
- **Sketch:** 02, parts 2 and 4.
- **Needs first:** slice 1.
- **Check:** the port's fixtures pass against the memory adapter under `bun test` and against
  s2-lite in the e2e lane. The appender's tests cover a lost reply, a second writer at the aimed
  offset, and a first attempt that lands late. After each case the stream holds the run once, beside
  what the other writer stored.

## 7. Ingest: the receive route

- **Outcome:** `@pepys/ingest` serves one route per receive path of a deployment, in the order of
  the sketch, with the listen address from the environment. It has the `SenderProof` port with its
  fake and its adapter that proves nothing, the drop of a body stored in the last hour, and the
  answers for a partial failure.
- **Sketch:** 02, parts 1 and 3; 01, part C.
- **Needs first:** slices 2 and 6.
- **Check:** a route test sends a signed fact batch through the real check, read and envelope check
  into the memory log, and reads the fact ID back. Table tests cover each answer: 401, 405, 413,
  415, 422, 500 and 503. A second send of a stored body appends nothing. A path that needs a sender
  answers 401 with no proof.

## 8. The manifest and the whole of `pepys build`

- **Outcome:** `pepys build` compiles each entry with scriptc and writes each module and
  `consumers.json`. `@pepys/schema` holds the manifest types, a strict schema and the manifest case
  file. The build compiles a consumer of a dependency from a copy of that package's source. The
  build scripts under `scripts/` go.
- **Sketch:** 03, parts A to C; 01, part H, steps 3 and 4.
- **Needs first:** slice 5.
- **Check:** the strict schema accepts and refuses each case of the case file. One case equals, byte
  for byte, what the build writes for the repo's stub deployment. A changed setting gives a new
  version hash.

## 9. The host reads the manifest

- **Outcome:** the host loads `consumers.json` strictly, through one checked load path, and runs a
  fact-mode consumer from its manifest alone: rows as JSON objects, symbols from the manifest, the
  wire's operations. It checks a new file against the manifest's columns. `up` takes no name for
  every listed consumer, and `run --up` deploys before it runs. The `pepys-schema` crate and the
  static consumer spec go.
- **Sketch:** 03, parts B, D, E, F1 and F2.
- **Needs first:** slices 1 and 8.
- **Check:** the Rust test reads the same manifest case file and gives each case the same verdict.
  Tests cover a schema mismatch, a version clash and a start with no current version. The GitHub
  pull request journey of the e2e lane passes on a module that `pepys build` built.

## 10. Links in the host

- **Outcome:** the host makes the `link` table, checks each link against the manifest, and writes
  and deletes links in fact mode.
- **Sketch:** 03, parts E and F5; 04, part 2.
- **Needs first:** slices 2 and 9.
- **Check:** the link case file passes against the Rust check. A link to an entity with no row is
  written. A link of an undeclared type rolls the batch back.

## 11. Scope mode and the fact index

- **Outcome:** the host runs a scope consumer: it indexes facts once per fact ID, calls the module
  per dirty scope with a bounded read, and replaces the scope by a diff.
- **Sketch:** 03, parts D, E, F3, F4 and F6.
- **Reference code:** the branch `spike/v1-host-scope` holds trial code for the scope batch, the
  scope replace, rows from a manifest, the fact index and the link check, with 9 tests that run a
  compiled module. Read it, and do not merge it: it fails clippy, and
  [Open for the builder](./v1-open.md#the-host) lists where it departs from the sketch. Slices 9 and
  10 can read its rows and links code too.
- **Needs first:** slice 10.
- **Check:** with a canned runner: a fact twice changes no row, no link and no change log row; a row
  that another scope owns stops the batch; a failure in the second of two dirty scopes rolls the
  first back. With a real module that `pepys build` built from a stub scope consumer, on a
  multi-thread runtime: the store holds the rows and links that the test store gives for the same
  facts.

## 12. The store reader and the API

- **Outcome:** `@pepys/api` serves `get_entity`, `neighbourhood` and each plug-in query from one
  router, at `/rpc` and as MCP tools at `/mcp`, on oRPC `2.0.0-beta.50`. A call attaches the current
  files read-only and sees the two shared views.
- **Sketch:** 04.
- **Needs first:** slice 3 for the queries on the memory reader; slices 10 and 11 for the
  integration test.
- **Check:** table tests cover the pure parts of the walk. The core queries pass on the memory
  reader, the missing-version path included. An integration test attaches files that the host wrote,
  and `tools/list` at `/mcp` returns every query with its description.

## 13. The GitHub plug-in

- **Outcome:** `@pepys/source-github` is a plug-in: seven families, fact IDs from the body hash,
  four consumers, the deploy tag pattern as a setting, the delivery query, the recovery pull and the
  resync pull.
- **Sketch:** 05, places 4 and 5, types B, flow parts 3 to 5.
- **Needs first:** slices 3, 7 and 8.
- **Check:** each consumer's tests assert operations, and the query's tests seed tables. A test
  sends two release updates with one update time and then the first body again under a new delivery
  ID, and the row keeps the second update. The resync test sends A, B and A again, and the row ends
  at what the API stub answers.

## 14. The telemetry plug-in

- **Outcome:** `@pepys/source-telemetry` stores each log record of a known product as a fact with
  its origin, and builds the two tables. Ingest serves `/v1/logs`, `/v1/metrics` and `/v1/traces`,
  and has the adapter that verifies a worker machine's identity token.
- **Sketch:** 05, places 1 to 3 and 6, types A, flow parts 1 and 2.
- **Needs first:** slices 3, 7 and 8.
- **Check:** an export sent twice, and its records in any order, give equal rows. Through the route
  with the fake sender proof, an export gets 200 with `{}` and each stored fact holds the origin.
  The metrics and traces paths get 200 and store nothing.

## 15. The end-to-end test in CI

- **Outcome:** the e2e lane builds one deployment with the telemetry plug-in, the GitHub plug-in and
  one outside package, and runs ingest, the host and the API against Garage and s2-lite. The outside
  package is a stub under `e2e/` that imports the kit as a published package would. The lane does
  not wait for a package of another repo.
- **Sketch:** all five.
- **Needs first:** slices 11 to 14.
- **Check:** signed fact batches and OTLP logs go in through the routes, and `get_entity`,
  `neighbourhood` and one query of each plug-in return the expected rows. The `e2e` job runs the
  lane and is green on `main`.

## 16. Release the packages and the host binary

- **Outcome:** every package that a deployment imports is on npm, and a release carries the
  `pepys-host` binary.
- **Sketch:** 01, the package list above part A.
- **Needs first:** slice 15.
- **Check:** a deployment in an empty folder installs the packages, builds its consumers, and starts
  the released binary with `run --up`.

## 17. Deploy through the cloud repo

- **Outcome:** the cloud repo runs a pepys deployment: Garage, s2-lite, ingest, the host with the
  API, and the bucket backup. The deployment builds its own image, starts the host with `run --up`,
  sets the API's listen address, and makes a public rule for exactly the routes that the route table
  marks public.
- **Sketch:** 01, place 4; 02, part 1; 04, part 4.
- **Needs first:** slice 16.
- **Check:** the cloud repo's pull request is green, and every pepys workload in the cluster is
  ready.

## 18. The live proof

- **Outcome:** pepys runs in the cluster and takes live data.
- **Sketch:** none.
- **Needs first:** slice 17, and the trust documents of the telemetry route's sender proof.
- **Check:** one live signed batch and one live OTLP log each show up in a query of the live API.
