import { expect, test } from 'bun:test';
import { z } from 'zod';
import { collectCoercedFields } from './collect-coerced-fields.ts';

test.each<{ row: string; field: z.ZodType; paths: string[] }>([
  { row: 'a coerced number', field: z.coerce.number(), paths: ['tally'] },
  { row: 'a coerced string', field: z.coerce.string(), paths: ['tally'] },
  { row: 'a coerced boolean', field: z.coerce.boolean(), paths: ['tally'] },
  { row: 'a plain number', field: z.number(), paths: [] },
  {
    row: 'a coerced number that may be null',
    field: z.coerce.number().nullable(),
    paths: ['tally'],
  },
  { row: 'an optional coerced number', field: z.coerce.number().optional(), paths: ['tally'] },
  { row: 'a coerced number with a default', field: z.coerce.number().default(0), paths: ['tally'] },
  { row: 'a list of coerced numbers', field: z.array(z.coerce.number()), paths: ['tally[]'] },
  { row: 'a coerced number in a union', field: z.union([z.coerce.number(), z.null()]), paths: [] },
  { row: 'a coerced date', field: z.coerce.date(), paths: [] },
  { row: 'a transform', field: z.string().transform(Number), paths: [] },
])('it finds $paths in $row', (row) => {
  const schema = z.object({ tally: row.field });

  expect(collectCoercedFields(schema, '')).toStrictEqual(row.paths);
});

test('it finds a coerced field of each object in a list', () => {
  const drawer = z.object({ label: z.string(), count: z.coerce.number() });
  const schema = z.object({ drawers: z.array(drawer) });

  expect(collectCoercedFields(schema, '')).toStrictEqual(['drawers[].count']);
});
