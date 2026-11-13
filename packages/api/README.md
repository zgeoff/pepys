<div align="center">
  <h1>@pepys/api</h1>

  <p>
    <a href="https://www.npmjs.com/package/@pepys/api"><img src="https://img.shields.io/npm/v/@pepys/api" alt="npm version"></a>
    <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  </p>

  <p>
    <a href="../../docs/README.md">Documentation</a>
  </p>
</div>

The pepys API, for Bun: typed queries over the store that the host writes.

A deployment serves the core queries and each plug-in's queries over oRPC and as MCP tools.

## Install

```sh
bun add @pepys/api
```

Serve a deployment's queries from an entry file, then call them with a typed client:

```ts
// serve-api.ts
import { serveAPI } from '@pepys/api';
import { deployment } from './deployment.ts';

serveAPI({ deployment, environment: process.env, argv: process.argv.slice(2) });
```

```sh
PEPYS_STORE_DIR=./store bun serve-api.ts
```

To compile the entry with `bun build --compile`, import `@pepys/api` before any other package that
loads the MCP SDK. Bun's bundler can leave out zod's start-up for the MCP SDK, and `@pepys/api` runs
it first. With another such package first, the binary exits at start with
`undefined is not a constructor (evaluating 'new ZodLazy(...)')`.

```ts
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { DeploymentClient } from '@pepys/api';
import type { deployment } from './deployment.ts';

const api: DeploymentClient<typeof deployment> = createORPCClient(
  new RPCLink({ url: '/rpc', origin: 'http://127.0.0.1:8081' }),
);

const pullRequest = await api.get_entity({ id: 'github:pull_request:9001' });
```

## Features

- `serveAPI`, which serves a deployment's queries at `/rpc`, and as MCP tools at `/mcp` behind the
  API's own OAuth server ([the API](../../docs/architecture/queries/api.md)). It also runs the OAuth
  server's admin commands: `passkeys`, `clients` and `grants`.
- `DeploymentClient`, the type of a typed client of a deployment's queries.
- The store reader over the host's Turso files.

## Documentation

The [pepys docs](../../docs/README.md) hold the design of the API and the store.
