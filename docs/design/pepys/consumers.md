# Consumers

A consumer is a pure function that turns facts into rows. It is written in TypeScript, compiled by
scriptc to a WebAssembly module, and run by the [host](./host.md) inside wasmtime with no network or
random number imports and with the clock bound to a constant. The host hands a consumer either one
fact or one scope, the consumer reads what it needs from the host, and it returns a list of
operations that the host applies. Because a consumer can do nothing else, the same facts always
produce the same output, and replay rebuilds every projection exactly.

## The contract

A consumer is a WASI preview 1 core module, the form scriptc emits. The host writes the fact or the
scope into the module's exported memory, calls the consumer's export, and reads the operations back
from memory. A scriptc host import returns only a number, so a read takes two host calls: the first
returns the length of the row, and the second writes the row into a buffer the consumer passes.

That second call relies on scriptc passing a byte buffer argument as a view of the module's own
memory, which scriptc documents only as borrowed for the call. A scriptc that copied the buffer
would hand the consumer an empty row, so the host's boundary tests run against every scriptc version
before pepys moves to it. The [host boundary spike](../../../research/host-boundary/README.md)
measured this shape against the others.

A consumer reads four things from the host:

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

The consumer declarations are the single source for three generated artifacts: the interface of the
module boundary, the Rust types the host uses, and the Kysely types the API queries with. A table
cannot have one shape in TypeScript and another in Rust. The interface is generated glue: the host's
Rust import and export bindings over module memory, and the consumer's TypeScript declarations of
the read imports.

## Compiler

scriptc compiles TypeScript and JavaScript to native code and WebAssembly using the types the
TypeScript compiler checks, and supports a subset of the language. pepys uses scriptc only, with no
second compiler. When a consumer uses something outside the subset, the consumer changes to fit.
Consumers are small pure functions with few imports, which keeps that rare. The
[scriptc spike](../../../research/scriptc-wasm/README.md) records the subset limits a consumer
meets.

Every consumer builds as a scriptc library with `determinism.fences` covering the Date, performance,
process, random, filesystem and OS APIs. Such a build refuses a call to any of them at compile time,
and the build fails unless scriptc attests the module deterministic. scriptc attests only a library
with a contract: a model record, a message union tagged by `kind`, and `init` and `update` exports.
Every consumer therefore has that shape.

scriptc's runtime reads the WASI clock once at startup, outside the consumer's code, so the host
binds the clock to a constant. The build needs zig 0.16.0, whose clang matches scriptc's runtime
pack.

## Code style

Consumers follow the zgeoff code-style skill and the repo's project skill. IDs are branded, so an ID
of one kind cannot pass where another kind is expected, and nothing casts. A consumer brands IDs
with a local brand type, because scriptc refuses a type-fest import even when it is type-only.
