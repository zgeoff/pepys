import { expectTypeOf, test } from 'bun:test';
import { defineConsumer } from '../consumers/define-consumer.ts';
import type { EntityID, StreamName } from '../ids/types.ts';
import { defineTable } from '../tables/define-table.ts';
import type { ConsumersDB, LinkRow } from './store-reader.ts';

test('it types the tables, the offsets and the two shared views of the attached consumers', () => {
  const tills = defineConsumer({
    name: 'ledger_till',
    entry: new URL('file:///ledger/consumers/ledger-till.ts'),
    input: { mode: 'fact', streams: ['facts.ledger.till'] },
    tables: {
      ledger_till: defineTable({
        columns: { id: { kind: 'entityID' } },
        primaryKey: ['id'],
        indexes: [],
      }),
    },
    entityViews: [],
    reads: [],
    links: [],
  });

  type Database = ConsumersDB<[typeof tills]>;

  expectTypeOf<keyof Database>().toEqualTypeOf<
    'ledger_till' | 'ledger_till.offsets' | 'entity' | 'link_effective'
  >();

  expectTypeOf<Database['ledger_till.offsets']>().toEqualTypeOf<{
    stream: StreamName;
    last_seq_num: number;
  }>();

  expectTypeOf<Database['link_effective']>().toEqualTypeOf<LinkRow>();
});

test('it brands the IDs of the two shared views', () => {
  type Database = ConsumersDB<readonly []>;

  expectTypeOf<Database['entity']['id']>().toEqualTypeOf<EntityID>();
  expectTypeOf<Database['entity']['actor']>().toEqualTypeOf<EntityID | null>();
  expectTypeOf<Database['link_effective']['from_id']>().toEqualTypeOf<EntityID>();
  expectTypeOf<Database['link_effective']['to_id']>().toEqualTypeOf<EntityID>();
  expectTypeOf<Database['link_effective']['scope']>().toEqualTypeOf<EntityID | null>();
});

test('it types only the two shared views for a call that names no consumer', () => {
  type Database = ConsumersDB<readonly []>;

  expectTypeOf<keyof Database>().toEqualTypeOf<'entity' | 'link_effective'>();
  expectTypeOf<Database['link_effective']>().toEqualTypeOf<LinkRow>();
});
