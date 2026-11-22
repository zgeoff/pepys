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

The plug-in receives the OTLP log exports of coding agents as facts. Its two consumers build one row
per model request and one per reported turn cost.

## Install

```sh
bun add @pepys/source-telemetry @pepys/kit
bun add -d @pepys/cli
```

Add the plug-in to a deployment, then build its consumers. Install zig and wasm-tools first: the
build compiles each consumer with them ([CLI README](../cli/README.md)).

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

On a machine that impz does not run, such as the owner's PC, run
[the forwarder](../../docs/architecture/plug-ins/telemetry-forwarder.md), the program
`pepys-telemetry-forwarder` that this package ships. It spools each OTLP log export of a coding
agent, and sends it to the
[sender route](../../docs/architecture/plug-ins/telemetry.md#the-sender-route) of ingest with an
identity token that the machine signs with its own key.

1. Install the package for the machine's user, and run `install`. It makes the machine's key and ID,
   writes a systemd user unit that it never starts, and prints the machine's trust document, which
   holds its issuer name and public key.

   ```sh
   bun add --global --exact @pepys/source-telemetry@<version>
   pepys-telemetry-forwarder install --issuer study-pc --audience forwarder.pepys.example \
     --ingest-url https://ingest.tailnet.example > study-pc.json
   ```

2. Copy `study-pc.json` into ingest's folder at `PEPYS_TELEMETRY_FORWARDER_ISSUERS`.
3. Start the unit, which runs `pepys-telemetry-forwarder run`:
   `systemctl --user enable --now pepys-telemetry-forwarder.service`.
4. Point the agent's OTLP exporter at `http://127.0.0.1:4318`.

`run` takes no flags and reads the variables below. `install` writes the last three into the unit
from its flags, and copies each of the first four that is set in its own environment. To start `run`
by hand, set them yourself. A second `run` on the same spool folder exits 1.

| Variable                       | Holds                                                                            | Default                                    |
| ------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------ |
| `PEPYS_FORWARDER_HOST`         | the address the receiver listens on                                              | `127.0.0.1`                                |
| `PEPYS_FORWARDER_PORT`         | the port the receiver listens on                                                 | `4318`                                     |
| `PEPYS_FORWARDER_SPOOL_DIR`    | the spool folder                                                                 | `~/.local/state/pepys-telemetry-forwarder` |
| `PEPYS_FORWARDER_IDENTITY_DIR` | the folder of the private key and the machine's ID, mode 0700                    | `~/.config/pepys-telemetry-forwarder`      |
| `PEPYS_FORWARDER_INGEST_URL`   | the URL of ingest, `https://<host>`; unset, the forwarder only receives          | none                                       |
| `PEPYS_FORWARDER_ISSUER`       | the `issuer` of the trust document; needed with an ingest URL                    | none                                       |
| `PEPYS_FORWARDER_AUDIENCE`     | the deployment's `PEPYS_TELEMETRY_FORWARDER_AUDIENCE`; needed with an ingest URL | none                                       |

The receiver answers `GET /health` on the same port with `{"send":"sending","failed":0}`: the state
of the send loop, and the count of lines that ingest refused for good. It answers 503 when `send` is
`stopped`, and 200 otherwise.

| `send`    | Means                                                                            |
| --------- | -------------------------------------------------------------------------------- |
| `off`     | no ingest URL is set; the spool keeps each export for a later `run` with one     |
| `sending` | ingest took the last export                                                      |
| `waiting` | ingest gave no answer, or a 503; the send loop tries again after a short wait    |
| `stopped` | ingest answered 401, 403, 404 or 500; the send loop tries again every 15 minutes |

## Documentation

For the routes, the facts and the consumers, read
[the telemetry plug-in](../../docs/architecture/plug-ins/telemetry.md).
