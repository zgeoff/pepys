import type { ConsumerDeclaration, ConsumerInput, TableDeclaration } from '@pepys/kit';
import { generateSqliteSchema } from '@pepys/kit/generators';
import type { ConsumerManifest, ManifestTable } from '@pepys/schema';
import { match } from 'ts-pattern';
import { buildModuleSymbols } from './build-module-symbols.ts';

// What the host knows of one consumer. Each field is copied by name, so a field that a later kit
// adds to a declaration never reaches the file unseen.
export function buildConsumerManifest(consumer: ConsumerDeclaration): ConsumerManifest {
  const symbols = buildModuleSymbols(consumer);

  return {
    name: consumer.name,
    input: toManifestInput(consumer.input),
    exports: symbols.exports,
    imports: symbols.imports,
    tables: Object.fromEntries(
      Object.entries(consumer.tables).map(([name, table]) => [name, toManifestTable(table)]),
    ),
    links: consumer.links.map((link) => ({
      name: link.name,
      from: [...link.from],
      to: [...link.to],
      hub: link.hub,
    })),
    schema: generateSqliteSchema(consumer),
  };
}

function toManifestInput(input: ConsumerInput): ConsumerInput {
  return match(input)
    .with({ mode: 'fact' }, (fact) => ({ mode: fact.mode, streams: [...fact.streams] }))
    .with({ mode: 'scope' }, (scope) => ({
      mode: scope.mode,
      scopeKind: scope.scopeKind,
      streams: [...scope.streams],
    }))
    .exhaustive();
}

function toManifestTable(table: TableDeclaration): ManifestTable {
  return {
    columns: Object.fromEntries(
      Object.entries(table.columns).map(([name, column]) => [
        name,
        { kind: column.kind, nullable: column.nullable === true },
      ]),
    ),
    primaryKey: [...table.primaryKey],
    indexes: table.indexes.map((index) => [...index.columns]),
  };
}
