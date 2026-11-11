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
types and its SQL schema. With `--out`, it also compiles each consumer with scriptc and writes
`consumers.json`.

## Install

```sh
bun add -d @pepys/cli
bunx pepys build src/plugin.ts
```

## Features

- `pepys build <file>`: check the deployment or plug-in that the file exports, and write its glue.
- `pepys build <file> --out <directory>`: also compile each consumer, which needs zig and
  wasm-tools.
- `pepys build <file> --check`: exit 1 when a glue file is stale.

## Documentation

The [pepys docs](../../docs/README.md) hold the design of `pepys build`.
