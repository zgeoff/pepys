import { expect, expectTypeOf, test } from 'bun:test';
import { z } from 'zod';
import { defineConsumer } from '../consumers/define-consumer.ts';
import type { EntityID } from '../ids/types.ts';
import { defineTable } from '../tables/define-table.ts';
import { defineQuery } from './define-query.ts';
import type { StoreTables } from './types.ts';

test('it gives back the query it is given', () => {
  const query = {
    name: 'ledger_takings',
    description: 'Sums the takings of a day.',
    input: z.object({ day: z.string() }),
    output: z.object({ cents: z.number() }),
    reads: [],
    handler: () => Promise.resolve({ cents: 0 }),
  };

  expect(defineQuery(query)).toBe(query);
});

test('it types the tables of two consumers as one database', () => {
  const tills = defineConsumer({
    name: 'ledger_till',
    entry: new URL('file:///ledger/consumers/ledger-till.ts'),
    input: { mode: 'fact', streams: ['facts.ledger.till'] },
    tables: {
      ledger_till: defineTable({
        columns: { id: { kind: 'entityID' }, float: { kind: 'real', nullable: true } },
        primaryKey: ['id'],
        indexes: [],
      }),
    },
    entityViews: [],
    reads: [],
    links: [],
  });

  const clerks = defineConsumer({
    name: 'roster_clerk',
    entry: new URL('file:///roster/consumers/roster-clerk.ts'),
    input: { mode: 'fact', streams: ['facts.roster.clerk'] },
    tables: {
      roster_clerk: defineTable({
        columns: { id: { kind: 'entityID' }, name: { kind: 'text' } },
        primaryKey: ['id'],
        indexes: [],
      }),
    },
    entityViews: [],
    reads: [],
    links: [],
  });

  expectTypeOf<StoreTables<[typeof tills, typeof clerks]>>().toEqualTypeOf<{
    ledger_till: { id: EntityID; float: number | null };
    roster_clerk: { id: EntityID; name: string };
  }>();
});
