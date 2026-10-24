import { expect, test } from 'bun:test';
import { defineTable } from './define-table.ts';
import type { TableRow } from './table-row.ts';

test('it declares the column names that a row of the table carries', () => {
  const table = defineTable({
    columns: {
      id: { kind: 'entityID' },
      title: { kind: 'text' },
      weight: { kind: 'real', nullable: true },
      done: { kind: 'boolean' },
      meta: { kind: 'json' },
    },
    primaryKey: ['id'],
    indexes: [{ columns: ['title'] }],
  });

  const row = {
    id: 'notes:note:7',
    title: 'groceries',
    weight: null,
    done: false,
    meta: { tags: ['home'] },
  } satisfies TableRow<typeof table>;

  expect(Object.keys(table.columns)).toStrictEqual(Object.keys(row));
});
