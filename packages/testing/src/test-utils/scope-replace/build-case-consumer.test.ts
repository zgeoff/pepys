import { expect, test } from 'bun:test';
import { ZodError } from 'zod';
import { buildCaseConsumer } from './build-case-consumer.ts';

test('it builds a scope consumer from the case file form, with each index as a column list', () => {
  const consumer = buildCaseConsumer({
    name: 'pier_berth',
    input: { mode: 'scope', scopeKind: 'pier:berth', streams: ['facts.pier.berth'] },
    tables: {
      pier_berth: {
        columns: {
          id: { kind: 'entityID', nullable: false },
          dock_id: { kind: 'entityID', nullable: false },
          label: { kind: 'text', nullable: true },
        },
        primaryKey: ['id'],
        indexes: [['dock_id'], ['dock_id', 'label']],
      },
    },
    links: [{ name: 'berth_of', from: ['pier:berth'], to: ['pier:dock'], hub: false }],
  });

  expect(consumer).toStrictEqual({
    name: 'pier_berth',
    entry: new URL('file:///scope-replace-cases/entry.ts'),
    input: { mode: 'scope', scopeKind: 'pier:berth', streams: ['facts.pier.berth'] },
    tables: {
      pier_berth: {
        columns: {
          id: { kind: 'entityID', nullable: false },
          dock_id: { kind: 'entityID', nullable: false },
          label: { kind: 'text', nullable: true },
        },
        primaryKey: ['id'],
        indexes: [{ columns: ['dock_id'] }, { columns: ['dock_id', 'label'] }],
      },
    },
    entityViews: [],
    reads: [],
    links: [{ name: 'berth_of', from: ['pier:berth'], to: ['pier:dock'], hub: false }],
  });
});

test.each([
  [
    'a fact-mode input',
    { mode: 'fact', scopeKind: 'pier:berth', streams: ['facts.pier.berth'] },
    'text',
  ],
  [
    'a stream with no source part',
    { mode: 'scope', scopeKind: 'pier:berth', streams: ['facts.pier'] },
    'text',
  ],
  [
    'a column kind the kit has not',
    { mode: 'scope', scopeKind: 'pier:berth', streams: ['facts.pier.berth'] },
    'date',
  ],
])('it throws for a case consumer with %s', (_label, input, kind) => {
  const building = () =>
    buildCaseConsumer({
      name: 'pier_berth',
      input,
      tables: {
        pier_berth: {
          columns: { id: { kind, nullable: false } },
          primaryKey: ['id'],
          indexes: [],
        },
      },
      links: [],
    });

  expect(building).toThrow(ZodError);
});
