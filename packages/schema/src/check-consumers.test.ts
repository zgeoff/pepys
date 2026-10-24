import { expect, test } from 'bun:test';
import { checkConsumers } from './check-consumers.ts';
import { defineConsumer } from './define-consumer.ts';
import { defineTable } from './define-table.ts';
import type { ConsumerDeclaration } from './types.ts';

test('it accepts consumers that own distinct tables and read a declared table', () => {
  const noteIndex = defineConsumer({
    name: 'note_index',
    mode: 'fact',
    streams: ['facts.notes.note'],
    tables: {
      note: defineTable({
        columns: {
          id: { kind: 'entityID' },
          title: { kind: 'text' },
          updated_at: { kind: 'timestamp' },
        },
        primaryKey: ['id'],
        indexes: [{ columns: ['title'] }],
      }),
    },
    entityView: {
      table: 'note',
      kind: 'note',
      id: 'id',
      title: 'title',
      url: 'title',
      actor: 'id',
      updatedAt: 'updated_at',
    },
    reads: [],
  });

  const noteStats = defineConsumer({
    name: 'note_stats',
    mode: 'scope',
    streams: ['facts.notes.note'],
    tables: {
      note_stat: defineTable({
        columns: { id: { kind: 'entityID' }, words: { kind: 'integer' } },
        primaryKey: ['id'],
        indexes: [],
      }),
    },
    reads: ['note', 'note_stat'],
  });

  expect(checkConsumers([noteIndex, noteStats])).toStrictEqual({ ok: true });
});

test('it rejects two consumers that declare one table', () => {
  const columns = { id: { kind: 'entityID' } } as const;

  const first = defineConsumer({
    name: 'first',
    mode: 'fact',
    streams: [],
    tables: { shared: defineTable({ columns, primaryKey: ['id'], indexes: [] }) },
    reads: [],
  });

  const second = defineConsumer({
    name: 'second',
    mode: 'fact',
    streams: [],
    tables: { shared: defineTable({ columns, primaryKey: ['id'], indexes: [] }) },
    reads: [],
  });

  expect(checkConsumers([first, second])).toStrictEqual({
    ok: false,
    failures: [{ kind: 'duplicate-table', table: 'shared', consumers: ['first', 'second'] }],
  });
});

test('it rejects a read of an undeclared table', () => {
  const reader = defineConsumer({
    name: 'reader',
    mode: 'scope',
    streams: [],
    tables: {
      seen: defineTable({ columns: { id: { kind: 'entityID' } }, primaryKey: ['id'], indexes: [] }),
    },
    reads: ['seen', 'missing'],
  });

  expect(checkConsumers([reader])).toStrictEqual({
    ok: false,
    failures: [{ kind: 'unknown-read', consumer: 'reader', table: 'missing' }],
  });
});

test('it rejects a primary key that names an unknown column', () => {
  const consumer = defineConsumer({
    name: 'keyed',
    mode: 'fact',
    streams: [],
    tables: {
      row: {
        columns: { id: { kind: 'entityID' } },
        primaryKey: ['identifier'],
        indexes: [],
      },
    },
    reads: [],
  });

  expect(checkConsumers([consumer])).toStrictEqual({
    ok: false,
    failures: [
      { kind: 'unknown-primary-key-column', consumer: 'keyed', table: 'row', column: 'identifier' },
    ],
  });
});

test('it rejects an index that names an unknown column', () => {
  const consumer = defineConsumer({
    name: 'indexed',
    mode: 'fact',
    streams: [],
    tables: {
      row: {
        columns: { id: { kind: 'entityID' } },
        primaryKey: ['id'],
        indexes: [{ columns: ['id', 'owner'] }],
      },
    },
    reads: [],
  });

  expect(checkConsumers([consumer])).toStrictEqual({
    ok: false,
    failures: [
      { kind: 'unknown-index-column', consumer: 'indexed', table: 'row', column: 'owner' },
    ],
  });
});

test('it rejects an entity view that names an unknown column', () => {
  const consumer = defineConsumer({
    name: 'viewed',
    mode: 'fact',
    streams: [],
    tables: {
      row: defineTable({
        columns: { id: { kind: 'entityID' }, title: { kind: 'text' } },
        primaryKey: ['id'],
        indexes: [],
      }),
    },
    entityView: {
      table: 'row',
      kind: 'row',
      id: 'id',
      title: 'title',
      url: 'link',
      actor: 'id',
      updatedAt: 'id',
    },
    reads: [],
  });

  expect(checkConsumers([consumer])).toStrictEqual({
    ok: false,
    failures: [
      { kind: 'unknown-entity-view-column', consumer: 'viewed', table: 'row', column: 'link' },
    ],
  });
});

test('it rejects an entity view that names an unknown table', () => {
  const consumer: ConsumerDeclaration = {
    name: 'viewed',
    mode: 'fact',
    streams: [],
    tables: {
      row: defineTable({ columns: { id: { kind: 'entityID' } }, primaryKey: ['id'], indexes: [] }),
    },
    entityView: {
      table: 'other',
      kind: 'row',
      id: 'id',
      title: 'id',
      url: 'id',
      actor: 'id',
      updatedAt: 'id',
    },
    reads: [],
  };

  expect(checkConsumers([consumer])).toStrictEqual({
    ok: false,
    failures: [{ kind: 'unknown-entity-view-table', consumer: 'viewed', table: 'other' }],
  });
});
