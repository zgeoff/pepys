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
bun add @pepys/source-telemetry
```

Add the plug-in to a deployment, then build its consumers:

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

## Documentation

The [pepys docs](../../docs/README.md) hold the design of the plug-ins.
