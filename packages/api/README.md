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

A deployment serves the core queries and each plug-in's queries over oRPC.

## Install

```sh
bun add @pepys/api
```

## Features

- The oRPC router and the app that serves it.
- The store reader over the host's Turso files.

## Documentation

The [pepys docs](../../docs/README.md) hold the design of the API and the store.
