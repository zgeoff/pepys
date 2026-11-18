<div align="center">
  <h1>@pepys/source-telemetry</h1>

  <p>
    <a href="https://www.npmjs.com/package/@pepys/source-telemetry"><img src="https://img.shields.io/npm/v/@pepys/source-telemetry" alt="npm version"></a>
    <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  </p>

  <p>
    <a href="../../docs/README.md">Documentation</a> •
    <a href="../../docs/architecture/plug-ins/telemetry.md">The telemetry plug-in</a>
  </p>
</div>

The pepys telemetry plug-in, for Bun.

The plug-in receives the OTLP log exports of coding agents as facts, and builds one row per model
request and one per reported turn cost with its two consumers.

## Install

```sh
bun add @pepys/source-telemetry @pepys/kit
bun add -d @pepys/cli
```

Add the plug-in to a deployment, then build its consumers. The build compiles each consumer, which
needs zig and wasm-tools, as the [CLI README](../cli/README.md) says.

```ts
// deployment.ts
import { defineDeployment } from '@pepys/kit';
import { telemetryPlugin } from '@pepys/source-telemetry';

export const deployment = defineDeployment({ name: 'home', plugins: [telemetryPlugin] });
```

```sh
bunx pepys build deployment.ts --out build
```

## Features

- `telemetryPlugin`: the plug-in, to add to a deployment.
- `telemetryModelRequestConsumer` and `telemetryTurnCostConsumer`: the consumers of the log record
  facts, with their SQL schemas.
- `sessionModelRequestsQuery`: the query `telemetry_session_model_requests`, which returns the model
  requests of one session that the named sender stored.

## The forwarder

The forwarder sends the telemetry of a machine outside impz to ingest. It takes each OTLP log export
on a loopback port, appends it to a spool file, and sends it to ingest's sender route with an
identity token that the machine signs with its own key.

```sh
bun add --global --exact @pepys/source-telemetry@<version>

pepys-telemetry-forwarder install --issuer study-pc --audience forwarder.pepys.example \
  --ingest-url https://ingest.tailnet.example
pepys-telemetry-forwarder run
```

`install` makes the key and the machine's ID, writes a systemd user unit, and prints the trust
document for the deployment on stdout. It enables and starts nothing. `run` starts the receiver, and
the send loop when an ingest URL is set.

| Variable                       | Holds                                                         | Default                                    |
| ------------------------------ | ------------------------------------------------------------- | ------------------------------------------ |
| `PEPYS_FORWARDER_HOST`         | the address the receiver listens on                           | `127.0.0.1`                                |
| `PEPYS_FORWARDER_PORT`         | the port the receiver listens on                              | `4318`                                     |
| `PEPYS_FORWARDER_SPOOL_DIR`    | the spool folder                                              | `~/.local/state/pepys-telemetry-forwarder` |
| `PEPYS_FORWARDER_IDENTITY_DIR` | the folder of the private key and the machine's ID, mode 0700 | `~/.config/pepys-telemetry-forwarder`      |
| `PEPYS_FORWARDER_INGEST_URL`   | the base URL of the tailnet name that reaches ingest          | none                                       |
| `PEPYS_FORWARDER_ISSUER`       | the machine's issuer name                                     | none                                       |
| `PEPYS_FORWARDER_AUDIENCE`     | the audience of each token                                    | none                                       |

`GET /health` answers `{"send":"sending","failed":0}`. `send` is `off` with no ingest URL, then
`sending`, `waiting` or `stopped`, and `failed` counts the lines that ingest refused. It answers 503
only when `send` is `stopped`.

## Documentation

The [pepys docs](../../docs/README.md) hold the design of the plug-ins.
