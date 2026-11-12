import { expect, expectTypeOf, test } from 'bun:test';
import { call, implement } from '@orpc/server';
import type { EntityID } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { z } from 'zod';
import { coreContract } from './core-contract.ts';
import type { CoreOutputs } from './core-contract.ts';

function setupTest() {
  const contract = implement(coreContract);

  const neighbourhood = contract.neighbourhood.handler((options) => ({
    entities: [],
    links: [],
    unresolved: [],
    skippedConsumers: [JSON.stringify(options.input)],
    isTruncated: false,
  }));

  // answers with the text it is given as the one unresolved ID
  const unresolved = contract.neighbourhood.handler((options) => ({
    entities: [],
    links: [],
    unresolved: [options.input.id],
    skippedConsumers: [],
    isTruncated: false,
  }));

  return { neighbourhood, unresolved };
}

test('it fills each left-out neighbourhood field with its default', async () => {
  const ctx = setupTest();

  const result = await call(ctx.neighbourhood, { id: 'harbour:vessel:7' });

  const parsed: unknown = JSON.parse(result.skippedConsumers[0] ?? '');

  expect(parsed).toStrictEqual({
    id: 'harbour:vessel:7',
    depthLimit: 1,
    entityLimit: 50,
    linkTypes: null,
    includeHubs: false,
    minimumConfidence: 0,
  });
});

test.each([
  { depthLimit: 0, entityLimit: 50, minimumConfidence: 0 },
  { depthLimit: 4, entityLimit: 50, minimumConfidence: 0 },
  { depthLimit: 1.5, entityLimit: 50, minimumConfidence: 0 },
  { depthLimit: 1, entityLimit: 0, minimumConfidence: 0 },
  { depthLimit: 1, entityLimit: 201, minimumConfidence: 0 },
  { depthLimit: 1, entityLimit: 50, minimumConfidence: -0.1 },
  { depthLimit: 1, entityLimit: 50, minimumConfidence: 1.2 },
])(
  'it refuses a neighbourhood with depth limit $depthLimit, entity limit $entityLimit and minimum confidence $minimumConfidence',
  (row) => {
    const ctx = setupTest();

    expect(call(ctx.neighbourhood, { id: 'harbour:vessel:7', ...row })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  },
);

test('it answers with an output whose IDs are entity IDs', async () => {
  const ctx = setupTest();

  const result = await call(ctx.unresolved, { id: 'harbour:vessel:7' });

  expect(result.unresolved).toStrictEqual([toTagged<EntityID>('harbour:vessel:7')]);
});

test('it refuses an output with an ID that is no entity ID', () => {
  const ctx = setupTest();

  expect(call(ctx.unresolved, { id: 'vessel-7' })).rejects.toMatchObject({
    code: 'INTERNAL_SERVER_ERROR',
  });
});

test('it brands the entity IDs of each output', () => {
  type EntityOutput = CoreOutputs['get_entity'];

  type NeighbourhoodOutput = CoreOutputs['neighbourhood'];

  expectTypeOf<EntityOutput['entity']['id']>().toEqualTypeOf<EntityID>();
  expectTypeOf<EntityOutput['entity']['actor']>().toEqualTypeOf<EntityID | null>();
  expectTypeOf<NeighbourhoodOutput['entities'][number]['id']>().toEqualTypeOf<EntityID>();
  expectTypeOf<NeighbourhoodOutput['links'][number]['from']>().toEqualTypeOf<EntityID>();
  expectTypeOf<NeighbourhoodOutput['links'][number]['to']>().toEqualTypeOf<EntityID>();
  expectTypeOf<NeighbourhoodOutput['unresolved'][number]>().toEqualTypeOf<EntityID>();
});

test.each([
  { procedure: 'get_entity', codes: ['BAD_REQUEST', 'NOT_FOUND', 'SERVICE_UNAVAILABLE'] },
  { procedure: 'neighbourhood', codes: ['BAD_REQUEST', 'NOT_FOUND'] },
] as const)('it declares the errors $codes on $procedure', (row) => {
  const errorMap: Record<string, unknown> = coreContract[row.procedure]['~orpc'].errorMap;

  expect(errorMap).toContainAllKeys([...row.codes]);
});

// A transform has no JSON Schema, so the MCP schemas could not carry it: zod throws on one when it
// writes the schema of what a parse returns.
test.each(['get_entity', 'neighbourhood'] as const)(
  'it gives the input and output of $procedure a JSON Schema with no transform',
  (procedure) => {
    const definition = coreContract[procedure]['~orpc'];
    const schemas = [...(definition.inputSchemas ?? []), ...(definition.outputSchemas ?? [])];
    const zodSchemas = schemas.filter((schema) => schema instanceof z.ZodType);

    expect(zodSchemas).toBeArrayOfSize(2);

    expect(() =>
      zodSchemas.map((schema) => z.toJSONSchema(schema, { io: 'output' })),
    ).not.toThrow();
  },
);
