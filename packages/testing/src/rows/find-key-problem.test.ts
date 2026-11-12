import { expect, test } from 'bun:test';
import { defineTable } from '@pepys/kit';
import { findKeyProblem } from './find-key-problem.ts';

test.each([
  { row: 'a whole key', key: { shelf: 'north', slot: 3 }, inexact: [], problem: undefined },
  {
    row: 'a column outside the key',
    key: { shelf: 'north', slot: 3, label: 'rope' },
    inexact: [],
    problem: 'label is not a key column',
  },
  {
    row: 'an integer written as 3.0',
    key: { shelf: 'north', slot: 3 },
    inexact: ['slot'],
    problem: 'the column slot holds 3',
  },
  {
    row: 'a null key value',
    key: { shelf: null, slot: 3 },
    inexact: [],
    problem: 'the column shelf holds null',
  },
  {
    row: 'a wrong value before an absent column',
    key: { slot: 'three' },
    inexact: [],
    problem: 'the column slot holds "three"',
  },
  {
    row: 'an absent key column',
    key: { slot: 3 },
    inexact: [],
    problem: 'the key column shelf is absent',
  },
])('it finds $problem in $row', (row) => {
  const table = defineTable({
    columns: { shelf: { kind: 'text' }, slot: { kind: 'integer' }, label: { kind: 'text' } },
    primaryKey: ['shelf', 'slot'],
    indexes: [],
  });

  expect(findKeyProblem(table, row.key, new Set(row.inexact))).toBe(row.problem);
});
