<div align="center">
  <h1>@pepys/source-github</h1>

  <p>
    <a href="https://www.npmjs.com/package/@pepys/source-github"><img src="https://img.shields.io/npm/v/@pepys/source-github" alt="npm version"></a>
    <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  </p>

  <p>
    <a href="../../docs/README.md">Documentation</a> •
    <a href="../../docs/architecture/plug-ins/github.md">The GitHub plug-in</a>
  </p>
</div>

The pepys GitHub plug-in, for Bun.

The plug-in receives GitHub's webhook deliveries as facts, and builds pull request rows from them
with its consumer.

## Install

```sh
bun add @pepys/source-github @pepys/kit
bun add -d @pepys/cli
```

Add the plug-in to a deployment, then build its consumers. The build compiles each consumer, which
needs zig and wasm-tools, as the [CLI README](../cli/README.md) says.

```ts
// deployment.ts
import { defineDeployment } from '@pepys/kit';
import { githubPlugin } from '@pepys/source-github';

export const deployment = defineDeployment({ name: 'home', plugins: [githubPlugin] });
```

```sh
bunx pepys build deployment.ts --out build
```

## Features

- `githubPlugin`: the plug-in, to add to a deployment.
- `githubPullRequestConsumer`: the consumer of pull request facts, with its SQL schema.
- `githubDelivery`: what a query of another plug-in needs to read when each pull request merged,
  released and deployed. Pass `consumers` as the query's `reads`, run `select(input).execute(db)`,
  and give the result's `rows` to `parse`.

## Documentation

The [pepys docs](../../docs/README.md) hold the design of the plug-ins.
