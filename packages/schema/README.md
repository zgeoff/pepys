<div align="center">
  <h1>@pepys/schema</h1>

  <p>
    <a href="https://www.npmjs.com/package/@pepys/schema"><img src="https://img.shields.io/npm/v/@pepys/schema" alt="npm version"></a>
    <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  </p>

  <p>
    <a href="../../docs/README.md">Documentation</a>
  </p>
</div>

The pepys consumer manifest, for Bun: the types and the strict schema of `consumers.json`.

`pepys build` writes `consumers.json`, and the pepys services read it. A plug-in needs only
[`@pepys/kit`](../kit/README.md).

## Install

```sh
bun add @pepys/schema
```

## Features

- `consumerBuildManifestSchema`: the strict schema of `consumers.json`, with its types.
- The types of a consumer's execution and of the link registry.
- The Kysely and Rust type generators for the store schema.

## Documentation

The [pepys docs](../../docs/README.md) hold the design of the manifest and the store.
