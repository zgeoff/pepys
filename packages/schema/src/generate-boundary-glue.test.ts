import { expect, test } from 'bun:test';
import { defineConsumer } from './define-consumer.ts';
import { defineTable } from './define-table.ts';
import { generateBoundaryGlue } from './generate-boundary-glue.ts';

test('it generates read declarations, getters and the operation type', () => {
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

  expect(generateBoundaryGlue({ consumer: report, consumers: [tracker, report] }))
    .toMatchInlineSnapshot(`
    "declare const idTag: unique symbol;

    export type EntityID = string & { readonly [idTag]: 'EntityID' };

    export interface ReportRow {
      id: string;
      ticket_count: number;
      meta: unknown;
    }

    export interface ReportLineRow {
      report_id: string;
      ticket_id: EntityID;
    }

    export interface TicketRow {
      id: EntityID;
      title: string;
      type: string;
      weight: number | null;
      done: boolean;
      notes: unknown;
      opened_at: string;
      owner_id: EntityID | null;
      points: number | null;
    }

    export interface ReportKey {
      id: string;
    }

    export interface ReportLineKey {
      report_id: string;
      ticket_id: EntityID;
    }

    export type TicketReportOperation =
      | { upsert: { report: ReportRow } }
      | { delete: { report: ReportKey } }
      | { upsert: { report_line: ReportLineRow } }
      | { delete: { report_line: ReportLineKey } };

    declare function readTicketLength(key: string): number;
    declare function readTicketInto(key: string, row: Uint8Array): void;

    declare function readReportLength(key: string): number;
    declare function readReportInto(key: string, row: Uint8Array): void;

    export function getTicket(key: string): TicketRow | undefined {
      const length = readTicketLength(key);

      if (length < 0) {
        return undefined;
      }

      const row = new Uint8Array(length);

      readTicketInto(key, row);

      const parsed: unknown = JSON.parse(new TextDecoder().decode(row));

      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return undefined;
      }

      if (!('id' in parsed) || !isEntityID(parsed.id)) {
        return undefined;
      }

      if (!('title' in parsed) || typeof parsed.title !== 'string') {
        return undefined;
      }

      if (!('type' in parsed) || typeof parsed.type !== 'string') {
        return undefined;
      }

      if (!('weight' in parsed) || (parsed.weight !== null && typeof parsed.weight !== 'number')) {
        return undefined;
      }

      if (!('done' in parsed) || typeof parsed.done !== 'boolean') {
        return undefined;
      }

      if (!('notes' in parsed)) {
        return undefined;
      }

      if (!('opened_at' in parsed) || typeof parsed.opened_at !== 'string') {
        return undefined;
      }

      if (!('owner_id' in parsed) || (parsed.owner_id !== null && !isEntityID(parsed.owner_id))) {
        return undefined;
      }

      if (!('points' in parsed) || (parsed.points !== null && typeof parsed.points !== 'number')) {
        return undefined;
      }

      return {
        id: parsed.id,
        title: parsed.title,
        type: parsed.type,
        weight: parsed.weight,
        done: parsed.done,
        notes: parsed.notes,
        opened_at: parsed.opened_at,
        owner_id: parsed.owner_id,
        points: parsed.points,
      };
    }

    export function getReport(key: string): ReportRow | undefined {
      const length = readReportLength(key);

      if (length < 0) {
        return undefined;
      }

      const row = new Uint8Array(length);

      readReportInto(key, row);

      const parsed: unknown = JSON.parse(new TextDecoder().decode(row));

      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return undefined;
      }

      if (!('id' in parsed) || typeof parsed.id !== 'string') {
        return undefined;
      }

      if (!('ticket_count' in parsed) || typeof parsed.ticket_count !== 'number') {
        return undefined;
      }

      if (!('meta' in parsed)) {
        return undefined;
      }

      return {
        id: parsed.id,
        ticket_count: parsed.ticket_count,
        meta: parsed.meta,
      };
    }

    function isEntityID(value: unknown): value is EntityID {
      return typeof value === 'string';
    }
    "
  `);
});

test('it generates only the row, key and operation types for a consumer with no reads', () => {
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

  expect(generateBoundaryGlue({ consumer: tracker, consumers: [tracker] })).toMatchInlineSnapshot(`
    "declare const idTag: unique symbol;

    export type EntityID = string & { readonly [idTag]: 'EntityID' };

    export interface TicketRow {
      id: EntityID;
      title: string;
      type: string;
      weight: number | null;
      done: boolean;
      notes: unknown;
      opened_at: string;
      owner_id: EntityID | null;
      points: number | null;
    }

    export interface TicketKey {
      id: EntityID;
    }

    export type TicketTrackerOperation =
      | { upsert: { ticket: TicketRow } }
      | { delete: { ticket: TicketKey } };
    "
  `);
});

test('it generates the same source for the same declarations', () => {
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

  expect(generateBoundaryGlue({ consumer: report, consumers: [tracker, report] })).toStrictEqual(
    generateBoundaryGlue({ consumer: report, consumers: [tracker, report] }),
  );
});
