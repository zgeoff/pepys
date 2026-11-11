import { expect, test } from 'bun:test';
import { defineConsumer, defineTable } from '@pepys/kit';
import type { ConsumerDeclaration } from '@pepys/kit';
import { generateKyselyTypes } from './generate-kysely-types.ts';

test('it generates a row interface per table and a DB interface keyed by table name', () => {
  const tracker = defineConsumer({
    name: 'ticket_tracker',
    entry: new URL('file:///stub/consumers/stub.ts'),
    input: { mode: 'fact', streams: ['facts.tickets.ticket'] },
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
    entityViews: [
      {
        table: 'ticket',
        kind: 'tickets:ticket',
        id: 'id',
        title: 'title',
        url: 'title',
        actor: 'owner_id',
        updatedAt: 'opened_at',
      },
    ],
    reads: [],
    links: [],
  });

  const report: ConsumerDeclaration = {
    name: 'ticket_report',
    entry: new URL('file:///stub/consumers/stub.ts'),
    input: {
      mode: 'scope',
      scopeKind: 'tickets:ticket',
      streams: ['facts.tickets.ticket', 'facts.tickets.comment'],
    },
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
    entityViews: [],
    reads: ['ticket', 'report'],
    links: [],
  };

  expect(generateKyselyTypes([tracker, report])).toMatchInlineSnapshot(`
    "export interface TicketRow {
      id: string;
      title: string;
      type: string;
      weight: number | null;
      done: 0 | 1;
      notes: unknown;
      opened_at: string;
      owner_id: string | null;
      points: number | null;
    }

    export interface ReportRow {
      id: string;
      ticket_count: number;
      meta: unknown;
    }

    export interface ReportLineRow {
      report_id: string;
      ticket_id: string;
    }

    export interface DB {
      ticket: TicketRow;
      report: ReportRow;
      report_line: ReportLineRow;
    }
    "
  `);
});

test('it generates the same source for the same declarations', () => {
  const tracker = defineConsumer({
    name: 'ticket_tracker',
    entry: new URL('file:///stub/consumers/stub.ts'),
    input: { mode: 'fact', streams: ['facts.tickets.ticket'] },
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
    entityViews: [
      {
        table: 'ticket',
        kind: 'tickets:ticket',
        id: 'id',
        title: 'title',
        url: 'title',
        actor: 'owner_id',
        updatedAt: 'opened_at',
      },
    ],
    reads: [],
    links: [],
  });

  expect(generateKyselyTypes([tracker])).toStrictEqual(generateKyselyTypes([tracker]));
});
