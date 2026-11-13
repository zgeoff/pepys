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
feature is one part the package owns, such as a port with its adapters, a job that enrichment runs,
or a CLI command. A port is an interface that pepys's own code calls for I/O, such as the blob
store, and an adapter is one implementation of it. The
[fact log doc](../../../docs/architecture/ingest/fact-log.md#ports-and-their-fixtures) lists the
ports.

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
- Put a helper that one feature imports in the smallest folder of that feature that holds every file
  that imports it. Put a helper that two or more features import in `src/utils/`, and a test helper
  that two or more features import in `src/test-utils/`.
- No `index.ts` in a feature folder. `src/index.ts` is the only barrel, with one exception. A public
  package may give a subpath to functions that a plug-in never imports, such as the generators that
  only `pepys build` calls. A plug-in that imports the main entry then can't reach them. To add one:
  - list the subpath in `exports` in `package.json`;
  - point the subpath at a file in `src/` with the subpath's name, such as `src/generators.ts` for
    `@pepys/kit/generators`;
  - write only re-exports in that file. Leave the functions in their feature folders, and out of
    `src/index.ts`.
- Never edit a file under `src/generated/` by hand. Change what it is generated from, such as a
  `defineConsumer` declaration, then run `bun run schema:generate`.
- Put each consumer of a source in `src/consumers/<consumer-file>.ts` of the source's package,
  `packages/source-<source>/`, with its test beside it as `<consumer-file>.test.ts`. This is the one
  exception to a folder per feature. Point the declaration's `entry` at the consumer file, with a
  URL relative to the declaration file. In the consumer file, import only other files under the
  package's `src/`. `pepys build` compiles a copy of `src/`, and the copy holds nothing else.
- Derive `<consumer-file>` from the name in the consumer's `defineConsumer` declaration, with each
  `_` changed to `-`, so `github_pull_request` becomes `github-pull-request`.
  [`github-pull-request-consumer.ts`](../../../packages/source-github/src/github-pull-request-consumer.ts)
  holds a declaration, in its own file beside `src/consumers/`. After you add a declaration, run
  `bun run schema:generate` to write the consumer's boundary file,
  `src/generated/<consumer-file>-boundary.ts`.
- Give a Rust crate the same shape. Write a feature as a `<feature>.rs` file with a `<feature>/`
  folder beside it for its adapters, and re-export the public API only from `lib.rs`.

## Consumers

- Write a consumer as a pure function. It takes one input and returns a list of operations, and the
  same input always gives the same list. The
  [host doc](../../../docs/architecture/consumers/host.md) describes the two input modes, fact and
  scope, and the operations the host applies to the store.
- Never read a clock, a random source, the network or a file in a consumer. Take a time from a field
  of the input.
- Import the types of the consumer's store rows and operations from
  `src/generated/<consumer-file>-boundary.ts`.
  [`github-pull-request.ts`](../../../packages/source-github/src/consumers/github-pull-request.ts)
  is a consumer to copy the shape from.

## IDs

- Brand every TypeScript ID with type-fest `Tagged`, and build one with `toTagged` from
  `@zgeoff/std`. A bare `string` never stands for an ID.
- In a consumer, import the ID types from `src/generated/<consumer-file>-boundary.ts`. scriptc,
  which compiles consumers to WebAssembly, refuses a type-fest import, even a type-only one.
  - Look in the boundary file for a `to<SourceKind>ID` function, where `<SourceKind>` is the kind in
    PascalCase, such as `toGithubPullRequestID` for `github:pull_request`. The generator writes one
    for each kind of the consumer's `entityViews` and of the `from` and `to` of its `links`. Pass it
    the last part of the ID, and it returns the whole branded ID: `toGithubPullRequestID('9001')`
    gives `github:pull_request:9001`.
  - For a kind with no such function, build the boundary file's `EntityID` with a type guard in the
    consumer file, as `github-pull-request.ts` does. The guard only checks that the text is not
    empty, so build the whole `<source>:<kind>:<id>` string yourself.
- Write an entity ID as `<source>:<kind>:<id>`, such as `github:pull_request:1874433021`, and brand
  the whole string. The source is a source's lowercase name, such as `github` or `gmail`, or
  `deployment` for an ID from the owner's own configuration. The last part is the ID the source
  gives the thing.
- Write each kind that the
  [entities and links doc](../../../docs/architecture/queries/entities-and-links.md#entity-ids)
  lists in the form that doc gives it, such as `pull_request`. Write a new kind in lowercase full
  words with `_` between them, such as `review_comment`, and add it to that doc.
