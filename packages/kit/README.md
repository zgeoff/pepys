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

Declare a pepys plug-in or deployment with the kit's `define*` functions.

A plug-in brings one or more sources of data to pepys, such as GitHub. A source sends facts: records
of what happened, which pepys never changes. Each source declares its facts, and the routes and
timers through which [ingest](../../docs/architecture/ingest/ingest.md) takes them in. The plug-in
also declares the consumers that turn facts into table rows, and the queries that read the rows. A
deployment lists the plug-ins that one pepys install runs.
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
  `toStreamOffset` turn text into the `StreamName` and `StreamOffset` types that the fact log
  functions take.
- `@pepys/kit` also holds `createLogger`, which writes one JSON line per call to any destination,
  such as an array in a test. Ingest gives its own logger, as `log`, to a source's `read` for each
  request on a route and to its `pull` on each timer.
  [Log lines](../../docs/architecture/ingest/ingest.md#log-lines) gives the format.
- `@pepys/kit/send` holds `createFactBatchSender`. Give it the source, the URL of the source's
  ingest route and the route's secret. It posts each batch of facts with the proof that the route's
  [delivery check](../../docs/architecture/ingest/ingest.md#a-delivery-step-by-step) asks for: an
  HMAC-SHA256 signature of the body, or the secret as a bearer token.
- `@pepys/kit/generators` holds the functions that write a consumer's SQL schema and its boundary
  file, which holds the TypeScript types of the consumer's rows and operations. `pepys build` calls
  them, so a plug-in never imports them.

## Entity IDs

An entity ID is text of the form `<source>:<kind>:<id>`, such as `github:pull_request:9001`, and its
type is `EntityID`. In a query, or in any code outside a consumer, check text with one of these:

- `isEntityID(text)`: a type guard that narrows the text to `EntityID` when it has that form.
- `entityIDSchema`: a zod schema that refuses any other text. Use it for each ID field in the input
  and output of a query. The API serves each query as an MCP tool too, and the tool's JSON Schema
  shows such a field to an MCP client as a plain string.

A consumer imports neither. `pepys build` compiles a consumer from a copy of its package's `src/`
alone, so the consumer builds its IDs with the functions of its own boundary file.

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
