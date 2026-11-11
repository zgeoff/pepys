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

The pepys consumer manifest types and the store schema generators, for Bun.

A pepys deployment and the pepys services share these types. A plug-in needs only
[`@pepys/kit`](../kit/README.md).

## Install

```sh
bun add @pepys/schema
```

## Features

- The types of a consumer's execution and of the link registry.
- The Kysely and Rust type generators for the store schema.

## Documentation

The [pepys docs](../../docs/README.md) hold the design of the manifest and the store.
