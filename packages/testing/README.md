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

Then apply facts, and test a query on the rows that the plug-in's consumers write from them. A query
test that seeds through the consumers fails when a consumer changes the shape of its rows:

```ts
import { expect, test } from 'bun:test';
import { createTestStore } from '@pepys/testing';
import { shelfPlugin, shelfSource, shelfTitleQuery } from './shelf-plugin.ts';

test('it answers a query from the row that a shelved fact gives', async () => {
  await using store = await createTestStore({ plugins: [shelfPlugin] });

  await store.apply(shelfSource, [
    {
      type: 'shelf.book.shelved',
      event: 'evt-1',
      entity: 'shelf:book:atlas',
      at: '2026-11-01T08:00:00.000Z',
      payload: { title: 'The Coral Atlas' },
    },
  ]);

  const answer = await store.query(shelfTitleQuery, { id: 'shelf:book:atlas' });

  expect(answer).toStrictEqual({ title: 'The Coral Atlas' });
});
```

```sh
bun test
```

## Features

- `createTestStore`: apply facts or write rows, then run a query, read rows and read links.
- `applyFactLog`: apply the facts that `createIngest` of `@pepys/ingest` stored in a memory fact log
  to a test store, in place of the host. A second call applies only the records the log stored after
  the first.
- `applyInBothOrders`: apply facts in two orders and compare the stores.
- The memory adapter of the store reader, for a test of a core query.

## Documentation

The [pepys docs](../../docs/README.md) hold the design of the test store.
