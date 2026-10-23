# Consumers

A consumer is a pure function that turns facts into rows. It is written in TypeScript, compiled by
scriptc to a WebAssembly module, and run by the [host](./host.md) inside wasmtime with no network,
clock or random number imports. The host hands a consumer either one fact or one scope, the consumer
reads what it needs through host calls, and it returns a list of operations that the host applies.
Because a consumer can do nothing else, the same facts always produce the same output, and replay
rebuilds every projection exactly.

## The contract

The boundary between the host and a module is defined in WIT, the interface language of the
WebAssembly Component Model.

Reads are host calls:

- get one row of a table by key;
- scan a table by an index and a key prefix;
- read every fact for one entity, from the fact index;
- read a blob by its content hash.

A blob read is pure because a hash always names the same bytes.

Writes come back as data: a list of operations, each an upsert or a delete of one row in one table.
The consumer never writes. This shape has three effects. The host checks ownership on a list before
anything is written. Running two module versions on the same facts and comparing their operation
lists gives a diff of the versions. A test passes in facts and asserts the returned operations, with
no database.

## Input modes

| Mode  | Input                                               | Used for                                                |
| ----- | --------------------------------------------------- | ------------------------------------------------------- |
| fact  | one fact from one stream                            | entity state from full-state events, single-event links |
| scope | one scope, such as a pull request or a Gmail thread | history, join links, entities built from delta events   |

A fact-mode consumer reads its stream in order and keeps an offset into it. Most source events carry
the full object, so the newest source update time wins and one fact is enough; a fact older than the
stored row changes nothing.

A scope-mode consumer runs when anything in its scope changes and recomputes everything it owns for
that scope from the current state. The result depends only on that state, not on the order the facts
arrived in, so a late fact or a backfill produces the same rows as live events would have. A scope
consumer listens to entity changes and never to link changes, because its own link writes would
otherwise trigger it again.

## Ownership

Each consumer declares the tables it owns, and the host enforces the declaration three ways. The
generated types give a consumer write access only to its own tables. The host refuses to start when
two consumers declare the same table. The host rejects any returned operation on a table the
consumer does not own.

An enrichment result never goes onto a source entity's row. It gets its own table and its own owner,
and a view joins the two, so a replay of either consumer leaves the other's data alone.

## The fact index

The host, not a consumer, indexes every fact by entity as it passes. The index holds the entity, the
source time, the stream, the sequence number, the fact ID, the fact kind and the payload. Scope
consumers read an entity's facts from it sorted by source time, which S2 cannot do because each
stream mixes every entity together. The index is a projection like any other and rebuilds from the
log.

## One schema source

The consumer declarations are the single source for three generated artifacts: the WIT for the
module boundary, the Rust types the host uses (generated from the WIT), and the Kysely types the API
queries with. A table cannot have one shape in TypeScript and another in Rust.

## Compiler

scriptc compiles TypeScript and JavaScript to native code and WebAssembly using the types the
TypeScript compiler checks, and supports a subset of the language. pepys uses scriptc only, with no
second compiler. When a consumer uses something outside the subset, the consumer changes to fit.
Consumers are small pure functions with few imports, which keeps that rare. The
[scriptc spike](../../../research/scriptc-wasm/README.md) proves the path before the first consumer.

## Code style

Consumers follow the zgeoff code-style skill and the repo's project skill. IDs are branded with
type-fest's `Tagged` type through `toTagged` from `@zgeoff/std`, so an ID of one kind cannot pass
where another kind is expected, and nothing casts.
