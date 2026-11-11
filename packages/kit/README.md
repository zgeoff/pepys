<div align="center">
  <h1>@pepys/kit</h1>

  <p>
    <a href="https://www.npmjs.com/package/@pepys/kit"><img src="https://img.shields.io/npm/v/@pepys/kit" alt="npm version"></a>
    <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  </p>

  <p>
    <a href="../../docs/README.md">Documentation</a> •
    <a href="../../docs/design/v1.md">pepys v1</a>
  </p>
</div>

Declare a pepys plug-in or deployment as plain data.

A plug-in names its fact families, sources, consumers, tables, links and queries with the kit's
`define*` functions. The kit checks a deployment, generates each consumer's glue and SQL schema, and
signs and sends a fact batch. The package ships its TypeScript source and runs on Bun.

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

- `@pepys/kit`: the `define*` declarations and the deployment check.
- `@pepys/kit/generators`: the SQL schema and glue generators.
- `@pepys/kit/send`: the client that signs and sends a fact batch.

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
