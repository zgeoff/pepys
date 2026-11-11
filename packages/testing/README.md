<div align="center">
  <h1>@pepys/testing</h1>

  <p>
    <a href="https://www.npmjs.com/package/@pepys/testing"><img src="https://img.shields.io/npm/v/@pepys/testing" alt="npm version"></a>
    <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  </p>

  <p>
    <a href="../../docs/README.md">Documentation</a>
  </p>
</div>

Test a pepys plug-in on Bun, with no host and no network.

The test store runs a plug-in's consumers over one in-memory database, with every table, the link
table and the shared views, and answers the plug-in's queries. It repeats the host's link check and
scope replace in TypeScript. It does not prove the scriptc compile or the Rust host.

## Install

```sh
bun add -d @pepys/testing
```

Set the compiler options from the [kit's README](../kit/README.md#configuration).

## Features

- `createTestStore`: apply facts or write rows, then run a query, read rows and read links.
- `applyInBothOrders`: apply facts in two orders and compare the stores.
- The memory adapter of the store reader, for a test of a core query.

## Documentation

The [pepys docs](../../docs/README.md) hold the design of the test store.
