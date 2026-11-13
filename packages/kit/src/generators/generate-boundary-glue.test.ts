import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { defineConsumer } from '../consumers/define-consumer.ts';
import { defineLinkType } from '../link-types/define-link-type.ts';
import { defineFactFamily } from '../sources/define-fact-family.ts';
import { defineTable } from '../tables/define-table.ts';
import { generateBoundaryGlue } from './generate-boundary-glue.ts';

function setupTest() {
  const hostFunctions: string[] = [];

  onTestFinished(() => {
    for (const name of hostFunctions) {
      Reflect.deleteProperty(globalThis, name);
    }
  });

  let loads = 0;

  return {
    // A fact consumer of one family whose one fact type has the given payload.
    generateNoteGlue: (payload: z.ZodType): string => {
      const family = defineFactFamily({
        stream: 'facts.ledger.note',
        api: 'ledger/1',
        entityKind: 'ledger:note',
        types: { 'ledger.note.written': payload },
      });

      const consumer = defineConsumer({
        name: 'ledger_note',
        entry: new URL('file:///stub/consumers/ledger-note.ts'),
        input: { mode: 'fact', streams: ['facts.ledger.note'] },
        tables: {},
        entityViews: [],
        reads: [],
        links: [],
      });

      return generateBoundaryGlue({ consumer, families: [family], settings: undefined });
    },

    // A scope consumer with a table, an entity view, a link type of two target kinds, and settings.
    generateShelfGlue: (
      settings: Readonly<Record<string, string | number | boolean>> | undefined,
    ): string => {
      const filled = z.object({ box: z.string() });

      const family = defineFactFamily({
        stream: 'facts.archive.shelf',
        api: 'archive/1',
        entityKind: 'archive:shelf',
        types: { 'archive.shelf.filled': filled, 'archive.shelf.emptied': z.object({}) },
      });

      const holds = defineLinkType({
        name: 'holds',
        from: ['archive:shelf'],
        to: ['archive:box', 'archive:crate'],
        hub: false,
      });

      const shelfTable = defineTable({
        columns: {
          id: { kind: 'entityID' },
          room_id: { kind: 'entityID', nullable: true },
          filled_at: { kind: 'timestamp' },
        },
        primaryKey: ['id'],
        indexes: [],
      });

      const consumer = defineConsumer({
        name: 'archive_shelf',
        entry: new URL('file:///stub/consumers/archive-shelf.ts'),
        input: { mode: 'scope', scopeKind: 'archive:shelf', streams: ['facts.archive.shelf'] },
        tables: { archive_shelf: shelfTable },
        entityViews: [
          {
            table: 'archive_shelf',
            kind: 'archive:shelf',
            id: 'id',
            title: 'id',
            url: null,
            actor: null,
            updatedAt: 'filled_at',
          },
        ],
        reads: [],
        links: [holds],
      });

      return generateBoundaryGlue({ consumer, families: [family], settings });
    },

    // A fact consumer of no family, with two tables, one of them in `reads`, and a link type.
    generateLedgerGlue: (): string => {
      const entryTable = defineTable({
        columns: {
          id: { kind: 'entityID' },
          amount: { kind: 'real' },
          memo: { kind: 'text', nullable: true },
          'posted-on': { kind: 'timestamp' },
          detail: { kind: 'json' },
        },
        primaryKey: ['id'],
        indexes: [],
      });

      const totalTable = defineTable({
        columns: { day: { kind: 'text' }, total: { kind: 'real' } },
        primaryKey: ['day'],
        indexes: [],
      });

      const cites = defineLinkType({
        name: 'cites',
        from: ['ledger:entry'],
        to: ['ledger:entry'],
        hub: false,
      });

      const consumer = defineConsumer({
        name: 'ledger_entry',
        entry: new URL('file:///stub/consumers/ledger-entry.ts'),
        input: { mode: 'fact', streams: ['facts.ledger.entry'] },
        tables: { ledger_entry: entryTable, ledger_total: totalTable },
        entityViews: [
          {
            table: 'ledger_entry',
            kind: 'ledger:entry',
            id: 'id',
            title: 'memo',
            url: null,
            actor: null,
            updatedAt: 'posted-on',
          },
        ],
        reads: ['ledger_entry'],
        links: [cites],
      });

      return generateBoundaryGlue({ consumer, families: [], settings: undefined });
    },

    // Writes the glue to a file and imports it, so a test runs the code the generator wrote.
    loadGlue: async (text: string): Promise<object> => {
      const directory = await mkdtemp(join(tmpdir(), 'pepys-glue-'));

      onTestFinished(async () => {
        await rm(directory, { recursive: true, force: true });
      });

      loads += 1;

      const path = join(directory, `glue-${loads}.ts`);

      await Bun.write(path, text);

      const glue: unknown = await import(path);

      if (typeof glue !== 'object' || glue === null) {
        throw new TypeError('the glue is not a module');
      }

      return glue;
    },

    call: (glue: object, name: string, ...args: unknown[]): unknown => {
      const exported: unknown = Reflect.get(glue, name);

      if (typeof exported !== 'function') {
        throw new TypeError(`the glue exports no function ${name}`);
      }

      const result: unknown = Reflect.apply(exported, undefined, args);

      return result;
    },

    // The two host functions of a read, which the module imports, answering with the given JSON.
    serveRead: (name: string, answers: Readonly<Record<string, unknown>>): void => {
      const encoder = new TextEncoder();

      hostFunctions.push(`read${name}Length`, `read${name}Into`);

      Reflect.set(globalThis, `read${name}Length`, (key: string): number =>
        key in answers ? encoder.encode(JSON.stringify(answers[key])).length : -1,
      );

      Reflect.set(globalThis, `read${name}Into`, (key: string, buffer: Uint8Array): void => {
        buffer.set(encoder.encode(JSON.stringify(answers[key])));
      });
    },
  };
}

test.each([
  { row: 'a string', schema: z.string(), type: 'string' },
  { row: 'a UUID', schema: z.uuid(), type: 'string' },
  { row: 'an ISO time', schema: z.iso.datetime(), type: 'string' },
  { row: 'a URL', schema: z.url(), type: 'string' },
  { row: 'a number', schema: z.int(), type: 'number' },
  { row: 'a boolean', schema: z.boolean(), type: 'boolean' },
  { row: 'a literal', schema: z.literal(['draft', 3]), type: "'draft' | 3" },
  { row: 'an enum', schema: z.enum(['open', 'shut']), type: "'open' | 'shut'" },
  { row: 'a brand', schema: z.string().brand<'Mark'>(), type: 'string' },
  {
    row: 'an object',
    schema: z.object({ pages: z.number() }),
    type: 'LedgerNoteWrittenPayloadValue',
  },
  { row: 'an array', schema: z.array(z.string()), type: 'string[]' },
  {
    row: 'an array of nullables',
    schema: z.array(z.string().nullable()),
    type: '(string | null)[]',
  },
  { row: 'a nullable', schema: z.string().nullable(), type: 'string | null' },
  { row: 'a record', schema: z.record(z.string(), z.number()), type: 'unknown' },
  { row: 'a union', schema: z.union([z.string(), z.number()]), type: 'unknown' },
  { row: 'a transform', schema: z.string().transform(Number), type: 'unknown' },
  { row: 'a lazy schema', schema: z.lazy(() => z.string()), type: 'unknown' },
  { row: 'a tuple', schema: z.tuple([z.string(), z.number()]), type: 'unknown' },
])('it types $row as $type', (row) => {
  const ctx = setupTest();
  const payload = z.object({ value: row.schema });
  const glue = ctx.generateNoteGlue(payload);

  expect(glue).toContain(`export interface LedgerNoteWrittenPayload {\n  value: ${row.type};\n}`);
});

test.each([
  { row: 'an optional field', schema: z.string().optional() },
  { row: 'an exact optional field', schema: z.exactOptional(z.string()) },
  { row: 'a field with a default', schema: z.string().default('none') },
])('it types $row as a field that may be absent', (row) => {
  const ctx = setupTest();
  const payload = z.object({ value: row.schema });
  const glue = ctx.generateNoteGlue(payload);

  expect(glue).toContain('export interface LedgerNoteWrittenPayload {\n  value?: string;\n}');
});

test('it types the fields of a nested object to any depth', () => {
  const ctx = setupTest();
  const box = z.object({ label: z.string() });
  const shelf = z.object({ box });
  const glue = ctx.generateNoteGlue(z.object({ shelf }));

  expect(glue).toContain(
    'export interface LedgerNoteWrittenPayloadShelfBox {\n  label: string;\n}',
  );
});

test.each([
  { row: 'a string', schema: z.string(), value: 'ink', decoded: 'ink' },
  { row: 'a number', schema: z.number(), value: 4.5, decoded: 4.5 },
  { row: 'a boolean', schema: z.boolean(), value: false, decoded: false },
  { row: 'a literal', schema: z.literal(['draft', 3]), value: 3, decoded: 3 },
  { row: 'an enum', schema: z.enum(['open', 'shut']), value: 'shut', decoded: 'shut' },
  { row: 'a brand', schema: z.string().brand<'Mark'>(), value: 'm-1', decoded: 'm-1' },
  {
    row: 'an object',
    schema: z.object({ pages: z.number() }),
    value: { pages: 9, binding: 'cloth' },
    decoded: { pages: 9 },
  },
  { row: 'an array', schema: z.array(z.string()), value: ['a', 'b'], decoded: ['a', 'b'] },
  { row: 'a nullable', schema: z.string().nullable(), value: null, decoded: null },
  { row: 'a record', schema: z.record(z.string(), z.number()), value: [1], decoded: [1] },
])('it decodes $row from $value as $decoded', async (row) => {
  const ctx = setupTest();
  const payload = z.object({ value: row.schema });

  const glue = await ctx.loadGlue(ctx.generateNoteGlue(payload));

  const fact = ctx.call(
    glue,
    'parseLedgerNoteFact',
    JSON.stringify({
      id: 'event:ledger:n-1',
      type: 'ledger.note.written',
      entity: 'ledger:note:1',
      at: '2026-11-01T08:00:00.000Z',
      payload: { value: row.value },
    }),
  );

  expect(fact).toStrictEqual({
    id: 'event:ledger:n-1',
    type: 'ledger.note.written',
    entity: 'ledger:note:1',
    at: '2026-11-01T08:00:00.000Z',
    payload: { value: row.decoded },
  });
});

test.each([
  { row: 'a string', schema: z.string(), value: 4 },
  { row: 'a number', schema: z.number(), value: '4' },
  { row: 'a boolean', schema: z.boolean(), value: 0 },
  { row: 'a literal', schema: z.literal(['draft', 3]), value: 'final' },
  { row: 'an enum', schema: z.enum(['open', 'shut']), value: 'ajar' },
  { row: 'an object', schema: z.object({ pages: z.number() }), value: { binding: 'cloth' } },
  { row: 'an array', schema: z.array(z.string()), value: ['a', 2] },
  { row: 'an array', schema: z.array(z.string()), value: 'a' },
  { row: 'a nullable', schema: z.string().nullable(), value: 7 },
])('it reads no fact when $row field holds $value', async (row) => {
  const ctx = setupTest();
  const payload = z.object({ value: row.schema });

  const glue = await ctx.loadGlue(ctx.generateNoteGlue(payload));

  const fact = ctx.call(
    glue,
    'parseLedgerNoteFact',
    JSON.stringify({
      id: 'event:ledger:n-1',
      type: 'ledger.note.written',
      entity: 'ledger:note:1',
      at: '2026-11-01T08:00:00.000Z',
      payload: { value: row.value },
    }),
  );

  expect(fact).toBeUndefined();
});

test('it decodes a list of objects to each item with only its declared fields', async () => {
  const ctx = setupTest();
  const label = z.object({ name: z.string() });
  const payload = z.object({ value: z.array(label) });

  const glue = await ctx.loadGlue(ctx.generateNoteGlue(payload));

  const fact = ctx.call(
    glue,
    'parseLedgerNoteFact',
    JSON.stringify({
      id: 'event:ledger:n-1',
      type: 'ledger.note.written',
      entity: 'ledger:note:1',
      at: '2026-11-01T08:00:00.000Z',
      payload: { value: [{ name: 'a', size: 2 }, { name: 'b' }] },
    }),
  );

  expect(fact).toStrictEqual({
    id: 'event:ledger:n-1',
    type: 'ledger.note.written',
    entity: 'ledger:note:1',
    at: '2026-11-01T08:00:00.000Z',
    payload: { value: [{ name: 'a' }, { name: 'b' }] },
  });
});

test('it reads no fact when one item of a list of objects does not fit', async () => {
  const ctx = setupTest();
  const label = z.object({ name: z.string() });
  const payload = z.object({ value: z.array(label) });

  const glue = await ctx.loadGlue(ctx.generateNoteGlue(payload));

  const fact = ctx.call(
    glue,
    'parseLedgerNoteFact',
    JSON.stringify({
      id: 'event:ledger:n-1',
      type: 'ledger.note.written',
      entity: 'ledger:note:1',
      at: '2026-11-01T08:00:00.000Z',
      payload: { value: [{ name: 'a' }, { name: 2 }] },
    }),
  );

  expect(fact).toBeUndefined();
});

test.each([
  { row: 'absent', payload: {} },
  { row: 'present', payload: { value: 'ink' } },
])('it decodes an optional field that is $row', async (row) => {
  const ctx = setupTest();
  const payload = z.object({ value: z.string().optional() });

  const glue = await ctx.loadGlue(ctx.generateNoteGlue(payload));

  const fact = ctx.call(
    glue,
    'parseLedgerNoteFact',
    JSON.stringify({
      id: 'event:ledger:n-1',
      type: 'ledger.note.written',
      entity: 'ledger:note:1',
      at: '2026-11-01T08:00:00.000Z',
      payload: row.payload,
    }),
  );

  expect(fact).toStrictEqual({
    id: 'event:ledger:n-1',
    type: 'ledger.note.written',
    entity: 'ledger:note:1',
    at: '2026-11-01T08:00:00.000Z',
    payload: row.payload,
  });
});

test('it reads no fact when an optional field has the wrong type', async () => {
  const ctx = setupTest();
  const payload = z.object({ value: z.string().optional() });

  const glue = await ctx.loadGlue(ctx.generateNoteGlue(payload));

  const fact = ctx.call(
    glue,
    'parseLedgerNoteFact',
    JSON.stringify({
      id: 'event:ledger:n-1',
      type: 'ledger.note.written',
      entity: 'ledger:note:1',
      at: '2026-11-01T08:00:00.000Z',
      payload: { value: 4 },
    }),
  );

  expect(fact).toBeUndefined();
});

test('it reads no fact of a type that no family on the streams declares', async () => {
  const ctx = setupTest();

  const glue = await ctx.loadGlue(ctx.generateNoteGlue(z.object({})));

  const fact = ctx.call(
    glue,
    'parseLedgerNoteFact',
    JSON.stringify({
      id: 'event:ledger:n-1',
      type: 'ledger.note.erased',
      entity: 'ledger:note:1',
      at: '2026-11-01T08:00:00.000Z',
      payload: {},
    }),
  );

  expect(fact).toBeUndefined();
});

test('it types the fact ID, the entity and the scope as branded IDs', () => {
  const ctx = setupTest();
  const glue = ctx.generateShelfGlue(undefined);

  expect(glue).toContain(
    [
      'export type ArchiveShelfFact =',
      "  | { id: FactID; type: 'archive.shelf.filled'; entity: EntityID; at: string; payload: ArchiveShelfFilledPayload }",
      "  | { id: FactID; type: 'archive.shelf.emptied'; entity: EntityID; at: string; payload: ArchiveShelfEmptiedPayload };",
      '',
      'declare function readScopeFactsLength(scope: ArchiveShelfID): number;',
      'declare function readScopeFactsInto(scope: ArchiveShelfID, facts: Uint8Array): void;',
    ].join('\n'),
  );
});

test.each([
  { row: 'an empty fact ID', id: '', entity: 'ledger:note:1' },
  { row: 'an empty entity ID', id: 'event:ledger:n-1', entity: '' },
])('it reads no fact with $row', async (row) => {
  const ctx = setupTest();

  const glue = await ctx.loadGlue(ctx.generateNoteGlue(z.object({})));

  const fact = ctx.call(
    glue,
    'parseLedgerNoteFact',
    JSON.stringify({
      id: row.id,
      type: 'ledger.note.written',
      entity: row.entity,
      at: '2026-11-01T08:00:00.000Z',
      payload: {},
    }),
  );

  expect(fact).toBeUndefined();
});

test('it reads the scope facts with an index loop, never for...of or filter', () => {
  const ctx = setupTest();
  const glue = ctx.generateShelfGlue(undefined);

  expect(glue).toContain('for (let index = 0; index < parsed.length; index += 1) {');
  expect(glue).not.toMatch(/for \(const|\.filter\(/u);
});

test('it reads the facts of the scope in the host order and leaves out what does not decode', async () => {
  const ctx = setupTest();

  const glue = await ctx.loadGlue(ctx.generateShelfGlue(undefined));

  const at = '2026-11-01T08:00:00.000Z';
  const entity = 'archive:shelf:s';

  ctx.serveRead('ScopeFacts', {
    [entity]: [
      { id: 'f-2', type: 'archive.shelf.filled', entity, at, payload: { box: 'b' } },
      { id: 'f-1', type: 'archive.shelf.filled', entity, at, payload: {} },
      { id: 'f-3', type: 'archive.shelf.moved', entity, at, payload: {} },
      { id: 'f-4', type: 'archive.shelf.emptied', entity, at, payload: {} },
    ],
  });

  expect(ctx.call(glue, 'readScopeFacts', entity)).toStrictEqual([
    { id: 'f-2', type: 'archive.shelf.filled', entity, at, payload: { box: 'b' } },
    { id: 'f-4', type: 'archive.shelf.emptied', entity, at, payload: {} },
  ]);
});

test('it writes the scope glue: rows, links and the operation union', () => {
  const ctx = setupTest();
  const glue = ctx.generateShelfGlue(undefined);

  expect(glue).toContain(
    [
      'export interface ArchiveShelfRow {',
      '  id: ArchiveShelfID;',
      '  room_id: EntityID | null;',
      '  filled_at: string;',
      '}',
      '',
      'export type ArchiveShelfOperation =',
      '  | { upsert: { archive_shelf: ArchiveShelfRow } }',
      "  | { link: { type: 'holds'; from: ArchiveShelfID; to: ArchiveBoxID | ArchiveCrateID; confidence: number; evidence: string } };",
      '',
      'export function linkHolds(link: { from: ArchiveShelfID; to: ArchiveBoxID | ArchiveCrateID; confidence: number; evidence: string }): ArchiveShelfOperation {',
      "  return { link: { type: 'holds', from: link.from, to: link.to, confidence: link.confidence, evidence: link.evidence } };",
      '}',
    ].join('\n'),
  );
});

test('it gives a scope consumer no delete and no unlink', () => {
  const ctx = setupTest();
  const glue = ctx.generateShelfGlue(undefined);

  expect(glue).not.toMatch(/delete:|unlink/u);
});

test('it builds an entity ID from the source ID and parses one of its own kind only', async () => {
  const ctx = setupTest();

  const glue = await ctx.loadGlue(ctx.generateShelfGlue(undefined));

  const results = [
    ctx.call(glue, 'toArchiveBoxID', 'b-7'),
    ctx.call(glue, 'parseArchiveBoxID', 'archive:box:b-7'),
    ctx.call(glue, 'parseArchiveBoxID', 'archive:crate:b-7'),
    ctx.call(glue, 'parseArchiveBoxID', 'archive:box:'),
  ];

  expect(results).toStrictEqual(['archive:box:b-7', 'archive:box:b-7', undefined, undefined]);
});

test('it writes the settings as one constant, with any key and any text', async () => {
  const ctx = setupTest();
  const settings = { 'tag-pattern': String.raw`shelf's\"<room>"`, limit: 3, strict: true };

  const glue = await ctx.loadGlue(ctx.generateShelfGlue(settings));

  expect(Reflect.get(glue, 'settings')).toStrictEqual({
    'tag-pattern': String.raw`shelf's\"<room>"`,
    limit: 3,
    strict: true,
  });
});

test('it writes no settings constant for a plug-in that declares none', () => {
  const ctx = setupTest();
  const glue = ctx.generateShelfGlue(undefined);

  expect(glue).not.toContain('export const settings');
});

test('it gives the entry file a model that a reset sets back to the start', async () => {
  const ctx = setupTest();

  const glue = await ctx.loadGlue(ctx.generateShelfGlue(undefined));

  const start = ctx.call(glue, 'initArchiveShelfModel');

  const applied = ctx.call(glue, 'updateArchiveShelfModel', start, {
    kind: 'apply',
    input: 'archive:shelf:s',
  });

  const reset = ctx.call(glue, 'updateArchiveShelfModel', applied, { kind: 'reset' });

  expect(reset).toStrictEqual(start);
});

test('it reads a row of a table in reads, and answers no row for -1', async () => {
  const ctx = setupTest();

  const glue = await ctx.loadGlue(ctx.generateLedgerGlue());

  const row = {
    id: 'ledger:entry:e-1',
    amount: 12.5,
    memo: null,
    'posted-on': '2026-11-01T08:00:00.000Z',
    detail: { lines: 2 },
  };

  ctx.serveRead('LedgerEntry', { [row.id]: row });

  const results = [
    ctx.call(glue, 'readLedgerEntryRow', 'ledger:entry:e-1'),
    ctx.call(glue, 'readLedgerEntryRow', 'ledger:entry:e-2'),
  ];

  expect(results).toStrictEqual([row, undefined]);
});

test('it reads no row whose ID is of another kind than the entity view', async () => {
  const ctx = setupTest();

  const glue = await ctx.loadGlue(ctx.generateLedgerGlue());

  ctx.serveRead('LedgerEntry', {
    'ledger:entry:e-1': {
      id: 'ledger:total:e-1',
      amount: 1,
      memo: null,
      'posted-on': '2026-11-01T08:00:00.000Z',
      detail: null,
    },
  });

  expect(ctx.call(glue, 'readLedgerEntryRow', 'ledger:entry:e-1')).toBeUndefined();
});

test('it writes a reader for the tables in reads only', () => {
  const ctx = setupTest();
  const glue = ctx.generateLedgerGlue();

  expect(glue).not.toContain('readLedgerTotal');
});

test('it gives a fact consumer a delete per table and an unlink per link type', () => {
  const ctx = setupTest();
  const glue = ctx.generateLedgerGlue();

  expect(glue).toContain(
    [
      'export type LedgerEntryOperation =',
      '  | { upsert: { ledger_entry: LedgerEntryRow } }',
      '  | { delete: { ledger_entry: LedgerEntryKey } }',
      '  | { upsert: { ledger_total: LedgerTotalRow } }',
      '  | { delete: { ledger_total: LedgerTotalKey } }',
      "  | { link: { type: 'cites'; from: LedgerEntryID; to: LedgerEntryID; confidence: number; evidence: string } }",
      "  | { unlink: { type: 'cites'; from: LedgerEntryID; to: LedgerEntryID } };",
    ].join('\n'),
  );
});
