---
name: project-code-style
description:
  The place for pepys's additions to the shared code-style skill. They cover the folders inside a
  package or crate, pure consumers that return operations, branded IDs, and the ID string form. Load
  beside code-style before writing, reviewing, moving, or renaming any TypeScript or Rust in pepys.
metadata:
  kind: rule-set
---

# pepys code style

## Departures

None.

## Folders

Group the files in a package's `src/` by feature, so a folder never fills with unrelated files. A
feature is one part the package owns: a port with its adapters, an enrichment job, or a CLI command.
A port is an interface that the core calls, and an adapter is one implementation of it. The
[architecture doc](../../../docs/design/pepys/architecture.md) lists the ports.

An invented package, to show the shape:

```text
packages/example/src/
  index.ts                 the only barrel: the package's public API
  blob-store/              a port with its adapters
    blob-store.ts          the port's interface, named after the folder
    build-blob-key.ts      a helper both adapters use
    garage/garage-blob-store.ts
    memory/memory-blob-store.ts
  consumers/               every consumer, one file each, in a source package
  utils/                   helpers that two or more features import
  test-utils/              test factories and test helpers that two or more features use
  generated/               generator output
```

- Give each feature its own folder, and put each adapter in a folder inside its port's folder.
- Put a helper, a test helper included, in the smallest folder that holds every file that imports
  it. A helper that two features import goes in `src/utils/`, or in `src/test-utils/` for a test
  helper.
- No `index.ts` in a feature folder. `src/index.ts` is the only barrel.
- Never edit a file under `src/generated/` by hand. Change its generator in `@pepys/schema`, then
  run `bun run schema:generate`.
- Put each consumer in `src/consumers/<consumer-name>.ts`, with its test beside it. This is the one
  exception to a folder per feature: [`build-consumers.ts`](../../../scripts/build-consumers.ts)
  finds a consumer only at that path.
- Give a Rust crate the same shape. Write a feature as a `<feature>.rs` file with a `<feature>/`
  folder beside it for its adapters, and re-export the public API only from `lib.rs`.

## Consumers

- Write a consumer as a pure function: it takes a fact and returns the operations for the host to
  apply. Then the same facts always give the same operations.
- Read no clock, random source, network or file in a consumer. Take a time from a field of the fact.
- Import the row and operation types of a consumer from `src/generated/<consumer-name>-boundary.ts`.
  [`github-pull-request.ts`](../../../packages/source-github/src/consumers/github-pull-request.ts)
  is a consumer to copy the shape from.

## IDs

- Brand every TypeScript ID with type-fest `Tagged`, and build one with `toTagged` from
  `@zgeoff/std`. A bare `string` never stands for an ID.
- In a consumer, import `EntityID` from `src/generated/<consumer-name>-boundary.ts`, and build one
  with a type guard in the consumer file, as `github-pull-request.ts` does. scriptc, which compiles
  consumers to WebAssembly, refuses a type-fest import, even a type-only one.
- Write an entity ID as `<source>:<kind>:<id>`, such as `github:pr:1874433021`, and brand the whole
  string. The source and the kind are one short lowercase word each, such as `pr` or `msg`, and the
  last part is the source's own ID.
