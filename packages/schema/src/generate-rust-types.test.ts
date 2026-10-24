import { expect, test } from 'bun:test';
import { defineConsumer } from './define-consumer.ts';
import { defineTable } from './define-table.ts';
import { generateRustTypes } from './generate-rust-types.ts';

test('it generates row structs, operation enums and read imports', () => {
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

  expect(generateRustTypes([tracker, report])).toMatchInlineSnapshot(`
    "#[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct ReadImport {
        pub table: &'static str,
        pub length: &'static str,
        pub into: &'static str,
    }

    #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
    pub struct TicketRow {
        pub id: String,
        pub title: String,
        pub r#type: String,
        pub weight: Option<f64>,
        pub done: bool,
        pub notes: Option<serde_json::Value>,
        pub opened_at: String,
        pub owner_id: Option<String>,
        pub points: Option<i64>,
    }

    #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
    pub struct TicketKey {
        pub id: String,
    }

    #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
    pub enum TicketTrackerUpsert {
        #[serde(rename = "ticket")]
        Ticket(TicketRow),
    }

    #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
    pub enum TicketTrackerDelete {
        #[serde(rename = "ticket")]
        Ticket(TicketKey),
    }

    #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
    #[serde(rename_all = "snake_case")]
    pub enum TicketTrackerOperation {
        Upsert(Box<TicketTrackerUpsert>),
        Delete(TicketTrackerDelete),
    }

    pub const TICKET_TRACKER_READS: [ReadImport; 0] = [];

    #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
    pub struct ReportRow {
        pub id: String,
        pub ticket_count: i64,
        pub meta: serde_json::Value,
    }

    #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
    pub struct ReportKey {
        pub id: String,
    }

    #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
    pub struct ReportLineRow {
        pub report_id: String,
        pub ticket_id: String,
    }

    #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
    pub struct ReportLineKey {
        pub report_id: String,
        pub ticket_id: String,
    }

    #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
    pub enum TicketReportUpsert {
        #[serde(rename = "report")]
        Report(ReportRow),
        #[serde(rename = "report_line")]
        ReportLine(ReportLineRow),
    }

    #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
    pub enum TicketReportDelete {
        #[serde(rename = "report")]
        Report(ReportKey),
        #[serde(rename = "report_line")]
        ReportLine(ReportLineKey),
    }

    #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
    #[serde(rename_all = "snake_case")]
    pub enum TicketReportOperation {
        Upsert(Box<TicketReportUpsert>),
        Delete(TicketReportDelete),
    }

    pub const TICKET_REPORT_READS: [ReadImport; 2] = [
        ReadImport {
            table: "ticket",
            length: "readTicketLength",
            into: "readTicketInto",
        },
        ReadImport {
            table: "report",
            length: "readReportLength",
            into: "readReportInto",
        },
    ];
    "
  `);
});

test('it generates a lone read import in the layout rustfmt gives it', () => {
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

  const single = defineConsumer({
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
    reads: ['ticket'],
  });

  expect(generateRustTypes([tracker, single])).toMatchInlineSnapshot(`
    "#[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct ReadImport {
        pub table: &'static str,
        pub length: &'static str,
        pub into: &'static str,
    }

    #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
    pub struct TicketRow {
        pub id: String,
        pub title: String,
        pub r#type: String,
        pub weight: Option<f64>,
        pub done: bool,
        pub notes: Option<serde_json::Value>,
        pub opened_at: String,
        pub owner_id: Option<String>,
        pub points: Option<i64>,
    }

    #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
    pub struct TicketKey {
        pub id: String,
    }

    #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
    pub enum TicketTrackerUpsert {
        #[serde(rename = "ticket")]
        Ticket(TicketRow),
    }

    #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
    pub enum TicketTrackerDelete {
        #[serde(rename = "ticket")]
        Ticket(TicketKey),
    }

    #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
    #[serde(rename_all = "snake_case")]
    pub enum TicketTrackerOperation {
        Upsert(Box<TicketTrackerUpsert>),
        Delete(TicketTrackerDelete),
    }

    pub const TICKET_TRACKER_READS: [ReadImport; 0] = [];

    #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
    pub struct ReportRow {
        pub id: String,
        pub ticket_count: i64,
        pub meta: serde_json::Value,
    }

    #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
    pub struct ReportKey {
        pub id: String,
    }

    #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
    pub struct ReportLineRow {
        pub report_id: String,
        pub ticket_id: String,
    }

    #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
    pub struct ReportLineKey {
        pub report_id: String,
        pub ticket_id: String,
    }

    #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
    pub enum TicketReportUpsert {
        #[serde(rename = "report")]
        Report(ReportRow),
        #[serde(rename = "report_line")]
        ReportLine(ReportLineRow),
    }

    #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
    pub enum TicketReportDelete {
        #[serde(rename = "report")]
        Report(ReportKey),
        #[serde(rename = "report_line")]
        ReportLine(ReportLineKey),
    }

    #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
    #[serde(rename_all = "snake_case")]
    pub enum TicketReportOperation {
        Upsert(Box<TicketReportUpsert>),
        Delete(TicketReportDelete),
    }

    pub const TICKET_REPORT_READS: [ReadImport; 1] = [ReadImport {
        table: "ticket",
        length: "readTicketLength",
        into: "readTicketInto",
    }];
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

  expect(generateRustTypes([tracker])).toStrictEqual(generateRustTypes([tracker]));
});
