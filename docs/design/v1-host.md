# The manifest and the host

`pepys build` writes one file, `consumers.json`, and `pepys-host` runs every consumer of a
deployment from that file alone. This doc is the part of [pepys v1](./v1.md) that covers the file,
the wire between a module and the host, and how the host applies a module's output in fact mode and
in scope mode. The host holds the name of no source, table or consumer. Both sections follow one
sketch, [03-manifest-host.ts](./v1/sketches/03-manifest-host.ts), and
[Open for the builder](./v1-open.md#the-host) lists where a run of a real module found that the
sketch does not match the host.

## The manifest

Sketch: [03-manifest-host.ts](./v1/sketches/03-manifest-host.ts), parts A to C.

`pepys build` writes `consumers.json`, and the host reads nothing else about a consumer. Each entry
is whole: the module's hash and path, the version, and a manifest with the input, the two export
symbols, the read imports with their symbols, the tables with their columns, the link types, and the
SQL schema. The file has no list that two entries share, so a kept version needs only its own entry.

- **The version** is a hash over the module's hash, the pins and the manifest. The build computes
  it. The host uses it as the name of the version's folder and never computes it, and it refuses two
  manifests under one version.
- **Strict parsing.** The host refuses a field it does not know, so a file from a newer build fails
  at once, with the field. One case file of whole `consumers.json` files runs against the TypeScript
  schema and against the Rust parser, and one case must equal what the build writes for the repo's
  stub deployment.
- **One load path.** Every way to load a consumer version ends in one check, so that no caller can
  skip it.
- **The wire.** A module returns one JSON list of operations, each with one verb: upsert, delete,
  link or unlink. A link is flat: a type, two entity IDs, a confidence from 0 to 1, and a fact ID as
  its evidence.

## The host

Sketch: [03-manifest-host.ts](./v1/sketches/03-manifest-host.ts), parts D to F.

`pepys-host` has three commands. `up` deploys a consumer version, `run` applies facts, and `preview`
shows what a version would change. `run` refuses to start when a listed consumer has no current
version, and `run --up` deploys every listed consumer first, so a deployment whose one entry command
is the host gets each version with no person.

**How the host runs a module.** The host links the module's read imports by the symbols in the
manifest, and calls the two exports in the manifest. The module reads through those imports,
computes, and returns its operations as text. Beside those reads, it imports a panic function and
four WASI calls, for the clock, the environment and the exit. The host parses the operations, and
the host runs the link check and the scope replace on that output. The module calls neither.

**`up`.** The host writes the module and its entry to a new version folder, runs the manifest's SQL
on a new file, and compares the file's tables with the manifest's columns before it reads one fact.
It replays beside the live version, takes the consumer's writer lock for the last facts, and swaps
the current version. The live `run` task opens the new folder on its next pass.

**A fact-mode batch** is one transaction: for each fact that the consumer has not applied, the
module, the parse, the link check, the writes; then the offset and one change log row. Any error
rolls the batch back and stops the consumer's task.

**A scope-mode batch** is up to 100 records of one stream:

1. Before the transaction, the host indexes the records it is about to read. The fact index is a
   file of its own, with one row per fact ID.
2. The dirty scopes are the entities of the batch's facts that have the consumer's scope kind, each
   once, in sorted order.
3. For each dirty scope, the host calls the module with the scope ID. The module's one read returns
   every fact of that entity up to the consumer's own offsets, sorted by source time, then stream,
   then sequence number.
4. The host checks every link, then replaces the scope.
5. The host writes the offset, and one change log row when a row or a link changed.

**The scope replace** is a diff. The host writes each returned row and link that is absent or
differs, with the scope as its owner, and deletes each row and link that the scope owned and did not
return. A row or a link that another scope owns stops the batch. A copy of a fact in the log changes
nothing: the index holds one row for it, the module returns the same result, and the diff is empty.

**The link check** takes the manifest alone. The link's type must be one that the consumer declares,
each end must be an entity ID of a kind that the type allows, the confidence must be from 0 to 1,
and the evidence must not be empty. The host never looks a row up, so a link to an entity that has
not arrived is written as it is. The case file
[`packages/kit/src/links/link-check-cases.json`](../../packages/kit/src/links/link-check-cases.json)
runs against the Rust check and its TypeScript twin.

### The scope replace case file

The case file
[`packages/testing/src/scope-replace/scope-replace-cases.json`](../../packages/testing/src/scope-replace/scope-replace-cases.json)
holds the scope replace as data. The test store's TypeScript replace runs every case in
`bun run test`. When scope mode is built in the Rust host, the host runs the same file, so the two
replaces stay equal.

The file holds a stub scope consumer, with its tables in the manifest's form, and a list of cases.
Each case gives the links stored before it, then batches. A batch lists the module output text of
each scope, in order, and either the change entries it gives or the kind of its refusal. The case
ends with every row of each table in key order, and every link sorted by type, from and to.

Each batch runs its scopes in order, in one transaction. A refusal rolls back the whole batch, the
scopes before it included. A scope consumer never returns a delete or an unlink: the replace deletes
what the scope no longer returns.

| Refusal          | Cause                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------- |
| `bad-operation`  | output that is no JSON list, an operation with two verbs, a delete or an unlink         |
| `not-owned`      | an upsert to a table that the consumer does not declare                                 |
| `bad-row`        | a column left out or unknown, a null in a column that is not nullable, a wrong kind     |
| `bad-link`       | a link that fails the link check                                                        |
| `duplicate-row`  | one row key twice in one scope result                                                   |
| `duplicate-link` | one link key twice in one scope result                                                  |
| `scope-conflict` | a row or a link of the consumer that another scope owns, or a link stored with no scope |

`not-owned` is about tables: the consumer wrote outside its own. `scope-conflict` is about rows in
the consumer's own tables: another scope of the same consumer holds the row or the link.

- **Numbers.** An integer column refuses a number written with a fraction or an exponent, even
  `5.0`. A REAL column and a link's confidence compare as floats, so `2` and `2.0` are one value. A
  JSON column compares as a value, whatever the order of its keys.
- **Row entries.** A written row gives `{ type: <table>, key, value, headers: { operation } }`, with
  the operation `insert` or `update`. An update adds `old_value`, the stored row. The key is the
  JSON text of the list of the key's values. A deleted row gives no `value`: it gives the type, the
  key, `old_value` and `headers: { operation: 'delete' }`.
- **Link entries.** A link gives the type `link`, the key as the JSON text of `[type, from, to]`,
  and the value `{ type, from, to, confidence, evidence }`, with `old_value` on an update. A deleted
  link gives only the type, the key and `headers: { operation: 'delete' }`.
- **Order.** The entries of one scope come as rows written, links written, rows deleted and links
  deleted, each sorted by key with a plain text comparison. The scopes of a batch keep their order.
