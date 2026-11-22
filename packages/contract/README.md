<div align="center">
  <h1>@pepys/contract</h1>

  <p>
    <a href="https://www.npmjs.com/package/@pepys/contract"><img src="https://img.shields.io/npm/v/@pepys/contract" alt="npm version"></a>
    <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  </p>

  <p>
    <a href="../../docs/README.md">Documentation</a>
  </p>
</div>

The oRPC contract of the pepys core queries, for Bun.

The pepys API serves this contract. Use the contract to type a client's calls of the core queries.

## Install

```sh
bun add @pepys/contract
```

Type a client of the core queries with the contract:

```ts
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import type { CoreContract } from '@pepys/contract';

const api: ContractRouterClient<CoreContract> = createORPCClient(
  new RPCLink({ url: '/rpc', origin: 'http://127.0.0.1:8081' }),
);

const around = await api.neighbourhood({ id: 'github:pull_request:9001' });
```

## Features

- `coreContract`: the routes of the core queries, with their input and output schemas.
- `CoreContract`: the type of `coreContract`, to type a client.

## Documentation

For the core queries and how the API serves them, read
[the API](../../docs/architecture/queries/api.md).
