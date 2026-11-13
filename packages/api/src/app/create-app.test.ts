import { expect, onTestFinished, test } from 'bun:test';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { checkDeployment, defineDeployment, definePlugin, defineQuery } from '@pepys/kit';
import type { EntityID } from '@pepys/kit';
import { createTestStore } from '@pepys/testing';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { z } from 'zod';
import type { DeploymentClient } from '../client/deployment-client.ts';
import { buildQueryContext } from '../queries/build-query-context.ts';
import { harbourPlugin, harbourSource } from '../test-utils/harbour/harbour-plugin.ts';
import { readMCPAnswer } from '../test-utils/read-mcp-answer.ts';
import { startAuthorizedMCP } from '../test-utils/start-authorized-mcp.ts';
import { createApp } from './create-app.ts';
import { createRouter } from './create-router.ts';

async function setupTest() {
  const deployment = defineDeployment({ name: 'harbour', plugins: [harbourPlugin] });

  const store = await createTestStore({ plugins: [harbourPlugin] });

  onTestFinished(() => store[Symbol.asyncDispose]());

  const checked = checkDeployment(deployment);

  invariant(checked.ok, 'the harbour deployment is valid');

  const logged: { message: string; error: unknown }[] = [];
  const context = buildQueryContext(store.reader, checked.value);

  const logError = (message: string, error: unknown) => {
    logged.push({ message, error });
  };

  const app = createApp(context, { logError, oauth: null });

  // the HTTP status of each /rpc answer, which the client's error does not carry
  const statuses: number[] = [];

  const link = new RPCLink({
    url: '/rpc',
    origin: 'http://pepys.test',

    // RPCLink fixes this option name
    // oxlint-disable-next-line zgeoff/function-verb
    fetch: async (url, init) => {
      const response = await app.handle(new Request(url, init));

      statuses.push(response.status);

      return response;
    },
  });

  const client: DeploymentClient<typeof deployment> = createORPCClient(link);

  return {
    store,
    client,
    statuses,
    logged,
    answerRequest: (request: Request) => app.handle(request),

    // each call starts the API with its OAuth routes and signs a client in
    callMCP: async (method: string, params: Readonly<Record<string, unknown>>) => {
      const mcp = await startAuthorizedMCP(context, logError);

      return readMCPAnswer(mcp.sendRequest, method, params);
    },
  };
}

test('it serves get_entity at /rpc', async () => {
  const ctx = await setupTest();

  await ctx.store.apply(harbourSource, [
    {
      type: 'harbour.vessel.named',
      event: 'evt-1',
      entity: 'harbour:vessel:7',
      at: '2026-11-01T08:00:00.000Z',
      payload: { name: 'Tern' },
    },
  ]);

  const found = await ctx.client.get_entity({ id: 'harbour:vessel:7' });

  expect(found).toStrictEqual({
    entity: {
      id: toTagged<EntityID>('harbour:vessel:7'),
      kind: 'harbour:vessel',
      title: 'Tern',
      url: null,
      actor: null,
      updated_at: '2026-11-01T08:00:00.000Z',
    },
    consumer: 'harbour_vessel',
    table: 'harbour_vessel',
    row: { id: 'harbour:vessel:7', name: 'Tern', updated_at: '2026-11-01T08:00:00.000Z' },
  });
});

test('it serves get_entity at /rpc by an alias', async () => {
  const ctx = await setupTest();

  await ctx.store.apply(harbourSource, [
    {
      type: 'harbour.vessel.named',
      event: 'evt-1',
      entity: 'harbour:vessel:7',
      at: '2026-11-01T08:00:00.000Z',
      payload: { name: 'Tern' },
    },
  ]);

  const found = await ctx.client.get_entity({ id: 'TERN' });

  expect(found).toStrictEqual({
    entity: {
      id: toTagged<EntityID>('harbour:vessel:7'),
      kind: 'harbour:vessel',
      title: 'Tern',
      url: null,
      actor: null,
      updated_at: '2026-11-01T08:00:00.000Z',
    },
    consumer: 'harbour_vessel',
    table: 'harbour_vessel',
    row: { id: 'harbour:vessel:7', name: 'Tern', updated_at: '2026-11-01T08:00:00.000Z' },
  });
});

test('it answers 400 for a get_entity with an empty ID', async () => {
  const ctx = await setupTest();

  const error = await ctx.client.get_entity({ id: '' }).then(
    () => null,
    (error_: unknown) => error_,
  );

  expect(error).toMatchObject({ code: 'BAD_REQUEST' });
  expect(ctx.statuses).toStrictEqual([400]);
});

test('it runs get_entity as an MCP tool by an alias', async () => {
  const ctx = await setupTest();

  await ctx.store.apply(harbourSource, [
    {
      type: 'harbour.vessel.named',
      event: 'evt-1',
      entity: 'harbour:vessel:7',
      at: '2026-11-01T08:00:00.000Z',
      payload: { name: 'Tern' },
    },
  ]);

  const answer = await ctx.callMCP('tools/call', { name: 'get_entity', arguments: { id: 'tern' } });

  const vessel = expect.objectContaining({ id: 'harbour:vessel:7' });

  expect(answer).toStrictEqual({
    jsonrpc: '2.0',
    id: 1,
    result: expect.objectContaining({
      structuredContent: expect.objectContaining({ entity: vessel }),
    }),
  });
});

test('it serves neighbourhood at /rpc with every default filled in', async () => {
  const ctx = await setupTest();

  await ctx.store.apply(harbourSource, [
    {
      type: 'harbour.voyage.departed',
      event: 'evt-1',
      entity: 'harbour:voyage:12',
      at: '2026-11-02T06:00:00.000Z',
      payload: { vessel: 'harbour:vessel:7', port: 'harbour:port:north', confidence: 1 },
    },
  ]);

  const near = await ctx.client.neighbourhood({ id: 'harbour:voyage:12' });

  expect(near).toStrictEqual({
    entities: [expect.objectContaining({ id: 'harbour:voyage:12', depth: 0 })],
    links: [expect.objectContaining({ type: 'voyage_of', to: 'harbour:vessel:7', depth: 1 })],
    unresolved: [toTagged<EntityID>('harbour:vessel:7')],
    skippedConsumers: [],
    isTruncated: false,
  });
});

test('it serves a plug-in query at /rpc by its name', async () => {
  const ctx = await setupTest();

  await ctx.store.apply(harbourSource, [
    {
      type: 'harbour.voyage.departed',
      event: 'evt-1',
      entity: 'harbour:voyage:12',
      at: '2026-11-02T06:00:00.000Z',
      payload: { vessel: 'harbour:vessel:7', port: 'harbour:port:north', confidence: 1 },
    },
  ]);

  const counted = await ctx.client.harbour_voyage_count({ vessel: 'harbour:vessel:7' });

  expect(counted).toStrictEqual({ count: 1 });
});

test('it answers 404 for an entity no row holds', async () => {
  const ctx = await setupTest();

  const error = await ctx.client.get_entity({ id: 'harbour:vessel:404' }).then(
    () => null,
    (error_: unknown) => error_,
  );

  expect(error).toMatchObject({ code: 'NOT_FOUND' });
  expect(ctx.statuses).toStrictEqual([404]);
});

test('it answers 400 for a neighbourhood whose depth limit fails the input schema', async () => {
  const ctx = await setupTest();

  const error = await ctx.client.neighbourhood({ id: 'harbour:voyage:12', depthLimit: 0 }).then(
    () => null,
    (error_: unknown) => error_,
  );

  expect(error).toMatchObject({ code: 'BAD_REQUEST' });
  expect(ctx.statuses).toStrictEqual([400]);
});

test('it answers 503 for a plug-in query whose consumer has no current version', async () => {
  const ctx = await setupTest();

  ctx.store.reader.markDown('harbour_voyage');

  const error = await ctx.client.harbour_voyage_count({ vessel: 'harbour:vessel:7' }).then(
    () => null,
    (error_: unknown) => error_,
  );

  expect(error).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  expect(ctx.statuses).toStrictEqual([503]);
});

test('it logs nothing for a call on an entity no row holds', async () => {
  const ctx = await setupTest();

  await ctx.client.get_entity({ id: 'harbour:vessel:404' }).catch(() => null);

  expect(ctx.logged).toStrictEqual([]);
});

test('it logs nothing for an MCP tool call whose arguments fail the input schema', async () => {
  const ctx = await setupTest();
  const answer = await ctx.callMCP('tools/call', { name: 'get_entity', arguments: {} });

  expect({ answer, logged: ctx.logged }).toStrictEqual({
    answer: { jsonrpc: '2.0', id: 1, result: expect.objectContaining({ isError: true }) },
    logged: [],
  });
});

test('it logs nothing for a plug-in query whose consumer has no current version', async () => {
  const ctx = await setupTest();

  ctx.store.reader.markDown('harbour_voyage');

  await ctx.client.harbour_voyage_count({ vessel: 'harbour:vessel:7' }).catch(() => null);

  expect(ctx.logged).toStrictEqual([]);
});

test('it lists the core procedures and every plug-in query as MCP tools, each with its description', async () => {
  const ctx = await setupTest();
  const listed = await ctx.callMCP('tools/list', {});

  expect(listed).toStrictEqual({
    jsonrpc: '2.0',
    id: 1,
    result: {
      tools: [
        expect.objectContaining({
          name: 'get_entity',
          description: expect.stringContaining('one entity'),
        }),
        expect.objectContaining({
          name: 'neighbourhood',
          description: expect.stringContaining('linked'),
        }),
        expect.objectContaining({
          name: 'harbour_voyage_count',
          description: 'Counts the voyages of one vessel.',
        }),
        expect.objectContaining({
          name: 'harbour_vessel_ports',
          description:
            'Lists the ports each named vessel left from, with the title of each voyage.',
        }),
      ],
    },
  });
});

test('it runs neighbourhood as an MCP tool with only the start given', async () => {
  const ctx = await setupTest();

  await ctx.store.apply(harbourSource, [
    {
      type: 'harbour.vessel.named',
      event: 'evt-1',
      entity: 'harbour:vessel:7',
      at: '2026-11-01T08:00:00.000Z',
      payload: { name: 'Tern' },
    },
  ]);

  const answer = await ctx.callMCP('tools/call', {
    name: 'neighbourhood',
    arguments: { id: 'harbour:vessel:7' },
  });

  const start = expect.objectContaining({ id: 'harbour:vessel:7', depth: 0 });

  expect(answer).toStrictEqual({
    jsonrpc: '2.0',
    id: 1,
    result: expect.objectContaining({
      structuredContent: expect.objectContaining({ entities: [start], links: [] }),
    }),
  });
});

test('it answers an MCP tool call that fails with an error result', async () => {
  const ctx = await setupTest();

  const answer = await ctx.callMCP('tools/call', {
    name: 'get_entity',
    arguments: { id: 'harbour:vessel:404' },
  });

  expect(answer).toStrictEqual({
    jsonrpc: '2.0',
    id: 1,
    result: expect.objectContaining({ isError: true }),
  });
});

test('it logs a plug-in query whose answer fails its own output schema', async () => {
  const query = defineQuery({
    name: 'harbour_tide',
    description: 'Gives the tide in whole metres.',
    input: z.object({}),
    output: z.object({ metres: z.number().int() }),
    reads: [],
    handler: () => Promise.resolve({ metres: 2.5 }),
  });

  const plugin = definePlugin({ name: 'tide', queries: [query] });
  const checked = checkDeployment(defineDeployment({ name: 'tide', plugins: [plugin] }));

  invariant(checked.ok, 'the tide deployment is valid');

  const store = await createTestStore({ plugins: [plugin] });

  onTestFinished(() => store[Symbol.asyncDispose]());

  const logged: { message: string; error: unknown }[] = [];

  const mcp = await startAuthorizedMCP(
    buildQueryContext(store.reader, checked.value),
    (message, error) => {
      logged.push({ message, error });
    },
  );

  await readMCPAnswer(mcp.sendRequest, 'tools/call', {
    name: 'harbour_tide',
    arguments: {},
  });

  expect(logged).toStrictEqual([
    {
      message: 'the /mcp call of harbour_tide failed',
      error: expect.objectContaining({ message: 'Output validation failed' }),
    },
  ]);
});

test('#createRouter refuses a plug-in query with a zod transform', () => {
  const query = defineQuery({
    name: 'harbour_tide',
    description: 'Gives the tide.',
    input: z.object({ at: z.string().transform((text) => new Date(text)) }),
    output: z.object({ metres: z.number() }),
    reads: [],
    handler: () => Promise.resolve({ metres: 2 }),
  });

  const plugin = definePlugin({ name: 'tide', queries: [query] });

  expect(() => createRouter(plugin.queries)).toThrow(/harbour_tide has a zod transform/u);
});

test('it answers /mcp with 404 when the API serves no OAuth routes', async () => {
  const ctx = await setupTest();

  const answered = await ctx.answerRequest(
    new Request('http://pepys.test/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }),
  );

  expect(answered.status).toBe(404);
});
