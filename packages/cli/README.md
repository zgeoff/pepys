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
`consumers.json`. `pepys start` runs a whole deployment: ingest, the API and the host.

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
- `pepys start <deployment-file>`: load the deployment that the file exports, start ingest and the
  API in the CLI's process, and spawn the host with `run --up`.

## Start a deployment

```sh
PEPYS_HOST_BIN=/opt/pepys/pepys bunx pepys start src/deployment.ts
```

`PEPYS_HOST_BIN` is the path of the host binary. The command exits 1 with a one-line message when it
is unset. Ingest, the API and the host read the same variables as they do when started alone, and
`pepys start` adds none.

| Exit code | When                                                                                        |
| --------- | ------------------------------------------------------------------------------------------- |
| 0         | SIGINT or SIGTERM, and every part stopped cleanly                                           |
| 1         | a part ended or failed to start, a part stopped uncleanly, or the file or variable is wrong |

## Documentation

The [pepys docs](../../docs/README.md) hold the design of `pepys build`.
