<div align="center">
  <h1>@pepys/kysely-turso</h1>

  <p>
    <a href="https://www.npmjs.com/package/@pepys/kysely-turso"><img src="https://img.shields.io/npm/v/@pepys/kysely-turso" alt="npm version"></a>
    <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  </p>

  <p>
    <a href="../../docs/README.md">Documentation</a>
  </p>
</div>

A Kysely dialect for Turso databases on Bun.

`createTursoDialect` takes a function that opens a `@tursodatabase/database` database, and gives
Kysely a dialect that queries it. The pepys test store and the pepys API use it.

## Install

```sh
bun add @pepys/kysely-turso
```

## Features

- `createTursoDialect`: the dialect to pass to `new Kysely({ dialect })`.

## Documentation

The [pepys docs](../../docs/README.md) hold the design of the store.
