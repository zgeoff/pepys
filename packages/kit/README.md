<div align="center">
  <h1>@pepys/kit</h1>

  <p>
    <a href="https://www.npmjs.com/package/@pepys/kit"><img src="https://img.shields.io/npm/v/@pepys/kit" alt="npm version"></a>
    <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  </p>

  <p>
    <a href="../../docs/README.md">Documentation</a> •
    <a href="../../docs/architecture/consumers/plug-ins-and-build.md">Plug-ins and the build</a>
  </p>
</div>

Declare a pepys plug-in or deployment as plain data.

A plug-in brings one or more sources of data to pepys, such as GitHub. Each source declares the
facts it sends and the paths that bring them into
[ingest](../../docs/architecture/ingest/ingest.md). The plug-in also declares the consumers that
turn those facts into table rows, and the queries that read the rows. A deployment lists the
plug-ins that one pepys install runs. You declare each part with a `define*` function of the kit.
[What a plug-in declares](../../docs/architecture/consumers/plug-ins-and-build.md#what-a-plug-in-declares)
explains each part. The package ships its TypeScript source and runs on Bun.

## Install

```sh
bun add @pepys/kit
bun add zod@"$(npm view @pepys/kit dependencies.zod)"
bun add -d @types/bun typescript
```

Install the zod version that the kit pins, as the second line does: a schema from another zod
version fails the type check of a `define*` call.

Test the plug-in with [`@pepys/testing`](../testing/README.md), and build it with
[`@pepys/cli`](../cli/README.md).

## Features

- `@pepys/kit` holds the `define*` functions, the [entity ID checks](#entity-ids), and
  `checkDeployment`, which returns each fault in a deployment, such as two plug-ins that declare the
  same stream of the [fact log](../../docs/architecture/ingest/fact-log.md). `toStreamName` and
  `toStreamOffset` brand a stream name and a position in a stream with their types.
- Ingest calls a source's `read` for each delivery and its `pull` on a timer, and passes each one
  its logger as `log`. `createLogger` builds a logger over any destination, such as an array of
  lines in a test. [Log lines](../../docs/architecture/ingest/ingest.md#log-lines) gives the format.
- `@pepys/kit/generators` holds the functions that `pepys build` calls to write a consumer's SQL
  schema and its boundary file: the TypeScript types of the consumer's rows and operations.
- `@pepys/kit/send` holds `createFactBatchSender`. It signs a batch of facts with the secret that
  the source's [delivery check](../../docs/architecture/ingest/ingest.md#a-delivery-step-by-step)
  names, and posts the batch to the source's ingest route.

## Entity IDs

An entity ID is text of the form `<source>:<kind>:<id>`, such as `github:pull_request:9001`, and its
type is `EntityID`. In code that is not a consumer, such as a query, check text with one of these:

- `isEntityID(text)`: a type guard that narrows the text to `EntityID` when it has that form.
- `entityIDSchema`: a zod schema that refuses any other text. Use it for each ID field in the input
  and output of a query. The API also serves each query as an MCP tool, and an MCP client sees such
  a field as a plain string in the tool's JSON Schema.

## Configuration

Your compiler checks the kit's source with your `tsconfig.json`, so set at least these options:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["ESNext"],
    "module": "Preserve",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "types": ["bun"]
  }
}
```

## Documentation

The [pepys docs](../../docs/README.md) hold the design of the kit and of each part of pepys.
