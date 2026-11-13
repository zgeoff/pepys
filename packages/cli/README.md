<div align="center">
  <h1>@pepys/cli</h1>

  <p>
    <a href="https://www.npmjs.com/package/@pepys/cli"><img src="https://img.shields.io/npm/v/@pepys/cli" alt="npm version"></a>
    <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  </p>

  <p>
    <a href="../../docs/README.md">Documentation</a>
  </p>
</div>

The `pepys` command line, for Bun.

`pepys build` checks a deployment or a plug-in, and writes the glue of each consumer: its boundary
types and its SQL schema. It can also compile each consumer with scriptc and writes
`consumers.json`. `pepys start` runs a whole deployment: ingest, the API and the host.

## Install

```sh
bun add -d @pepys/cli
bunx pepys build src/plugin.ts
```

## Features

- `pepys build`: check the deployment or plug-in that a file exports, and write its glue
  ([Plug-ins and the build](../../docs/architecture/consumers/plug-ins-and-build.md)).
- Compile each consumer to WebAssembly, which needs zig and wasm-tools
  ([Build the consumers](../../docs/runbooks/deploying.md#2-build-the-consumers)).
- Check that every glue file is current, for CI.
- `pepys start`: run ingest, the API and the host of a deployment from one command
  ([Start every process with one command](../../docs/runbooks/deploying.md#start-every-process-with-one-command)).

## Documentation

The [pepys docs](../../docs/README.md) hold the design of `pepys build`.
