---
name: project-code-style
description:
  pepys's departures from the shared code-style skill and its additions to it. They cover the
  consumer's init and update wrappers, the folders inside a package or crate, pure consumers that
  return operations, branded IDs, and the ID string form. Load beside code-style before writing,
  reviewing, moving, or renaming any TypeScript or Rust in pepys.
metadata:
  kind: rule-set
---

# pepys code style

## Departures

- Export an `init` and an `update` from each consumer file that only pass their arguments to the
  generated functions in the consumer's boundary file, `src/generated/<consumer-file>-boundary.ts`.
  This replaces the shared rule against such a wrapper, in
  [Structure](../code-style/SKILL.md#structure). scriptc, the compiler that builds each consumer,
  needs both declared in the consumer file, and refuses a re-export. For the rest of what scriptc
  checks, read [Plug-ins and build](../../../docs/architecture/consumers/plug-ins-and-build.md). Put
  the consumer's own logic in its other exports, such as `applyFact`.

  ```ts
  export function init(): GithubRefModel {
    return initGithubRefModel();
  }

  export function update(model: GithubRefModel, message: GithubRefMessage): GithubRefModel {
    return updateGithubRefModel(model, message);
  }
  ```

## Folders

Group the files in a package's `src/` by feature, so a folder never fills with unrelated files. A
feature is one part the package owns, such as a port with its adapters, a job that enrichment runs,
or a CLI command. A port is an interface that pepys's own code calls for I/O, such as the blob
store, and an adapter is one implementation of it. Find the ports in the
[fact log doc](../../../docs/architecture/ingest/fact-log.md#ports-and-their-fixtures).

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
- Never put an `index.ts` in a feature folder. `src/index.ts` is the only barrel, with one
  exception. In a public package, you may give a subpath to functions that a plug-in never imports,
  such as the generators that only `pepys build` calls, so that a plug-in that imports the main
  entry can't reach them. To add one:
  - list the subpath in `exports` in `package.json`;
  - point the subpath at a file in `src/` with the subpath's name, such as `src/generators.ts` for
    `@pepys/kit/generators`;
  - write only re-exports in that file. Leave the functions in their feature folders, and out of
    `src/index.ts`.
- Never edit a file under `src/generated/` by hand. Change what it is generated from, such as a
  `defineConsumer` declaration, then run `bun run schema:generate`.
- Give each consumer of a source two files in the source's package, `packages/source-<source>/`.
  These are the exceptions to a folder per feature:
  - its `defineConsumer` declaration in `src/<consumer-file>-consumer.ts`, such as
    [`github-pull-request-consumer.ts`](../../../packages/source-github/src/github-pull-request-consumer.ts);
  - the consumer itself in `src/consumers/<consumer-file>.ts`, with its test beside it as
    `<consumer-file>.test.ts`.
- Derive `<consumer-file>` from the name in the declaration, with each `_` changed to `-`, so
  `github_pull_request` becomes `github-pull-request`. Point the declaration's `entry` at the
  consumer file, with a URL relative to the declaration file. After you add a declaration, run
  `bun run schema:generate` to write the consumer's boundary file,
  `src/generated/<consumer-file>-boundary.ts`.
- In the consumer file, import only other files under the package's `src/`, never a package.
  `pepys build` compiles a copy of `src/`, and the copy holds nothing else.
- Give a Rust crate the same shape. Write a feature as a `<feature>.rs` file with a `<feature>/`
  folder beside it for its adapters, and re-export the public API only from `lib.rs`.

## Consumers

- Write the consumer's logic, such as `applyFact`, as a pure function. It takes one input and
  returns a list of operations, and the same input always gives the same list. The `init` and
  `update` wrappers in [Departures](#departures) only pass their arguments on. Read the
  [host doc](../../../docs/architecture/consumers/host.md) for the two input modes, fact and scope,
  and for the operations the host applies to the store.
- Never read a clock, a random source, the network or a file in a consumer. Take a time from a field
  of the input.
- Import the types of the consumer's store rows and operations from
  `src/generated/<consumer-file>-boundary.ts`. Copy the shape of a consumer from
  [`github-pull-request.ts`](../../../packages/source-github/src/consumers/github-pull-request.ts).

## IDs

- Give every TypeScript ID a branded type. A bare `string` never stands for an ID.
- Outside a consumer, brand an ID with type-fest `Tagged`, and build one with `toTagged` from
  `@zgeoff/std`.
- In a consumer, import the ID types from `src/generated/<consumer-file>-boundary.ts`, and never use
  `Tagged` or `toTagged`. scriptc refuses a type-fest import, even a type-only one.
  - Look in the boundary file for a `to<SourceKind>ID` function, where `<SourceKind>` is the source
    and the kind in PascalCase, such as `toGithubPullRequestID` for `github:pull_request`. The
    generator writes one for each kind of the consumer's `entityViews` and of the `from` and `to` of
    its `links`. Pass it the source's own identifier, a plain string, and it returns the branded
    entity ID: `toGithubPullRequestID('9001')` gives `github:pull_request:9001`.
  - For a kind with no such function, build the boundary file's `EntityID` with a type guard in the
    consumer file, as `github-pull-request.ts` does. The guard only checks that the text is not
    empty, so build the whole `<source>:<kind>:<id>` string yourself.
- Write an entity ID as `<source>:<kind>:<id>`, such as `github:pull_request:1874433021`, and brand
  the whole string. The source is a source's lowercase name, such as `github` or `gmail`, or
  `deployment` for an ID from the owner's own configuration. The last part is the source's own
  identifier for the thing, a plain string until it sits inside the entity ID.
- Write each kind listed in the
  [entities and links doc](../../../docs/architecture/queries/entities-and-links.md#entity-ids) in
  the form given there, such as `pull_request`. Write a new kind in lowercase full words with `_`
  between them, such as `review_comment`, and add it to that doc.
