import { expect, test } from 'bun:test';
import { buildEntityRow } from './build-entity-row.ts';

test('it turns stored flags into booleans and stored JSON into values', () => {
  const table = {
    columns: {
      id: { kind: 'entityID' },
      number: { kind: 'integer' },
      is_draft: { kind: 'boolean' },
      closed_at: { kind: 'timestamp', nullable: true },
      payload: { kind: 'json' },
    },
    primaryKey: ['id'],
    indexes: [],
  } as const;

  const stored = {
    id: 'github:pr:5',
    number: 5,
    is_draft: 1,
    closed_at: null,
    payload: '{"labels":["map"]}',
  };

  expect(buildEntityRow(table, stored)).toStrictEqual({
    id: 'github:pr:5',
    number: 5,
    is_draft: true,
    closed_at: null,
    payload: { labels: ['map'] },
  });
});

test('it reads a stored zero flag as false', () => {
  const table = {
    columns: { is_draft: { kind: 'boolean' } },
    primaryKey: [],
    indexes: [],
  } as const;

  expect(buildEntityRow(table, { is_draft: 0 })['is_draft']).toBe(false);
});
