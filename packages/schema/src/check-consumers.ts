import type { ConsumerDeclaration, TableDeclaration } from './types.ts';

export type ConsumerFailure =
  | { kind: 'duplicate-table'; table: string; consumers: string[] }
  | { kind: 'unknown-read'; consumer: string; table: string }
  | { kind: 'unknown-primary-key-column'; consumer: string; table: string; column: string }
  | { kind: 'unknown-index-column'; consumer: string; table: string; column: string }
  | { kind: 'unknown-entity-view-table'; consumer: string; table: string }
  | { kind: 'unknown-entity-view-column'; consumer: string; table: string; column: string };

export type ConsumerCheck = { ok: true } | { ok: false; failures: ConsumerFailure[] };

export function checkConsumers(consumers: readonly ConsumerDeclaration[]): ConsumerCheck {
  const owners = collectOwners(consumers);

  const failures = [
    ...[...owners].flatMap(([table, names]): ConsumerFailure[] =>
      names.length > 1 ? [{ kind: 'duplicate-table', table, consumers: names }] : [],
    ),
    ...consumers.flatMap((consumer) => [
      ...consumer.reads.flatMap((table): ConsumerFailure[] =>
        owners.has(table) ? [] : [{ kind: 'unknown-read', consumer: consumer.name, table }],
      ),
      ...Object.entries(consumer.tables).flatMap(([table, declaration]) =>
        checkTableColumns(consumer.name, table, declaration),
      ),
      ...checkEntityView(consumer),
    ]),
  ];

  return failures.length === 0 ? { ok: true } : { ok: false, failures };
}

function collectOwners(consumers: readonly ConsumerDeclaration[]): Map<string, string[]> {
  const owners = new Map<string, string[]>();

  for (const consumer of consumers) {
    for (const table of Object.keys(consumer.tables)) {
      owners.set(table, [...(owners.get(table) ?? []), consumer.name]);
    }
  }

  return owners;
}

function checkTableColumns(
  consumer: string,
  table: string,
  declaration: TableDeclaration,
): ConsumerFailure[] {
  return [
    ...declaration.primaryKey
      .filter((column) => !(column in declaration.columns))
      .map((column): ConsumerFailure => ({
        kind: 'unknown-primary-key-column',
        consumer,
        table,
        column,
      })),
    ...declaration.indexes
      .flatMap((index) => index.columns)
      .filter((column) => !(column in declaration.columns))
      .map((column): ConsumerFailure => ({
        kind: 'unknown-index-column',
        consumer,
        table,
        column,
      })),
  ];
}

function checkEntityView(consumer: ConsumerDeclaration): ConsumerFailure[] {
  const view = consumer.entityView;

  if (view === undefined) {
    return [];
  }

  const table = consumer.tables[view.table];

  if (table === undefined) {
    return [{ kind: 'unknown-entity-view-table', consumer: consumer.name, table: view.table }];
  }

  return [view.id, view.title, view.url, view.actor, view.updatedAt]
    .filter((column) => !(column in table.columns))
    .map((column): ConsumerFailure => ({
      kind: 'unknown-entity-view-column',
      consumer: consumer.name,
      table: view.table,
      column,
    }));
}
