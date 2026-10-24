import { expect, test } from 'bun:test';
import { defineConsumer } from './define-consumer.ts';
import { defineTable } from './define-table.ts';
import { generateSqliteSchema } from './generate-sqlite-schema.ts';

test('it generates tables, indexes and the entity view', () => {
  const tracker = defineConsumer({
    name: 'ticket_tracker',
    mode: 'fact',
    streams: ['facts.tickets.ticket'],
    tables: {
      ticket: defineTable({
        columns: {
          id: { kind: 'entityID' },
          title: { kind: 'text' },
          type: { kind: 'text' },
          weight: { kind: 'real', nullable: true },
          done: { kind: 'boolean' },
          notes: { kind: 'json', nullable: true },
          opened_at: { kind: 'timestamp' },
          owner_id: { kind: 'entityID', nullable: true },
          points: { kind: 'integer', nullable: true },
        },
        primaryKey: ['id'],
        indexes: [{ columns: ['owner_id'] }, { columns: ['type', 'opened_at'] }],
      }),
    },
    entityView: {
      table: 'ticket',
      kind: 'ticket',
      id: 'id',
      title: 'title',
      url: 'title',
      actor: 'owner_id',
      updatedAt: 'opened_at',
    },
    reads: [],
  });

  expect(generateSqliteSchema(tracker)).toMatchInlineSnapshot(`
    "CREATE TABLE ticket (
      id TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      weight REAL,
      done INTEGER NOT NULL,
      notes TEXT,
      opened_at TEXT NOT NULL,
      owner_id TEXT,
      points INTEGER,
      PRIMARY KEY (id)
    );

    CREATE INDEX ticket_owner_id_idx ON ticket (owner_id);

    CREATE INDEX ticket_type_opened_at_idx ON ticket (type, opened_at);

    CREATE VIEW entity AS
    SELECT
      id AS id,
      'ticket' AS kind,
      title AS title,
      title AS url,
      owner_id AS actor,
      opened_at AS updated_at
    FROM ticket;
    "
  `);
});

test('it generates a table with a composite primary key and no view', () => {
  const report = defineConsumer({
    name: 'ticket_report',
    mode: 'scope',
    streams: ['facts.tickets.ticket', 'facts.tickets.comment'],
    tables: {
      report: defineTable({
        columns: {
          id: { kind: 'text' },
          ticket_count: { kind: 'integer' },
          meta: { kind: 'json' },
        },
        primaryKey: ['id'],
        indexes: [],
      }),
      report_line: defineTable({
        columns: { report_id: { kind: 'text' }, ticket_id: { kind: 'entityID' } },
        primaryKey: ['report_id', 'ticket_id'],
        indexes: [],
      }),
    },
    reads: ['ticket', 'report'],
  });

  expect(generateSqliteSchema(report)).toMatchInlineSnapshot(`
    "CREATE TABLE report (
      id TEXT NOT NULL,
      ticket_count INTEGER NOT NULL,
      meta TEXT NOT NULL,
      PRIMARY KEY (id)
    );

    CREATE TABLE report_line (
      report_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      PRIMARY KEY (report_id, ticket_id)
    );
    "
  `);
});

test('it generates the same source for the same declaration', () => {
  const tracker = defineConsumer({
    name: 'ticket_tracker',
    mode: 'fact',
    streams: ['facts.tickets.ticket'],
    tables: {
      ticket: defineTable({
        columns: {
          id: { kind: 'entityID' },
          title: { kind: 'text' },
          type: { kind: 'text' },
          weight: { kind: 'real', nullable: true },
          done: { kind: 'boolean' },
          notes: { kind: 'json', nullable: true },
          opened_at: { kind: 'timestamp' },
          owner_id: { kind: 'entityID', nullable: true },
          points: { kind: 'integer', nullable: true },
        },
        primaryKey: ['id'],
        indexes: [{ columns: ['owner_id'] }, { columns: ['type', 'opened_at'] }],
      }),
    },
    entityView: {
      table: 'ticket',
      kind: 'ticket',
      id: 'id',
      title: 'title',
      url: 'title',
      actor: 'owner_id',
      updatedAt: 'opened_at',
    },
    reads: [],
  });

  expect(generateSqliteSchema(tracker)).toStrictEqual(generateSqliteSchema(tracker));
});
