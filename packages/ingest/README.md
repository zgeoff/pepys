<div align="center">
  <h1>@pepys/ingest</h1>

  <p>
    <a href="https://www.npmjs.com/package/@pepys/ingest"><img src="https://img.shields.io/npm/v/@pepys/ingest" alt="npm version"></a>
    <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  </p>

  <p>
    <a href="../../docs/README.md">Documentation</a>
  </p>
</div>

pepys ingest, for Bun: it receives each source's deliveries and appends them to the fact log.

A deployment serves one receive route for each receive path of its sources. Each route checks its
delivery, and appends the facts it reads to the fact log.

## Install

```sh
bun add @pepys/ingest
```

Serve a deployment's routes from an entry file, with the S2 settings and each secret its routes
name:

```ts
// serve-ingest.ts
import { serveIngest } from '@pepys/ingest';
import { deployment } from './deployment.ts';

await serveIngest({ deployment, environment: process.env });
```

```sh
export PEPYS_S2_ACCESS_TOKEN  # the S2 access token, set in your shell beforehand
PEPYS_S2_ENDPOINT=http://127.0.0.1:8090 PEPYS_S2_BASIN=pepys bun serve-ingest.ts
```

## Features

- `serveIngest` and `createIngest`: the receive routes of a deployment.
- The sender proof port, with the adapter that verifies a worker machine's identity token through
  `@impz/client/identity`.
- The fact log port, with its S2 and memory adapters.
- The blob store port, with its Garage and local folder adapters.

## Documentation

The [pepys docs](../../docs/README.md) hold the design of ingest and the log.
