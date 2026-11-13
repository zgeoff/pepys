import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { checkDeployment, defineDeployment } from '@pepys/kit';
import type { EntityID } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { createApp } from '../app/create-app.ts';
import type { DeploymentClient } from '../client/deployment-client.ts';
import { buildQueryContext } from '../queries/build-query-context.ts';
import { createStoreReader } from '../store-reader/create-store-reader.ts';
import { writeCurrentVersion } from '../test-utils/create-consumer-version.ts';
import { harbourPlugin, harbourVesselConsumer } from '../test-utils/harbour/harbour-plugin.ts';
import { seedHarbourFiles } from '../test-utils/harbour/seed-harbour-files.ts';
import { readMCPAnswer } from '../test-utils/read-mcp-answer.ts';
import { startAuthorizedMCP } from '../test-utils/start-authorized-mcp.ts';

async function setupTest() {
  const deployment = defineDeployment({ name: 'harbour', plugins: [harbourPlugin] });

  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const storeDirectory = await mkdtemp(join(tmpdir(), 'pepys-api-files-'));

  stack.defer(() => rm(storeDirectory, { recursive: true, force: true }));

  const store = createStoreReader({ storeDirectory });

  stack.defer(() => store.close());

  const checked = checkDeployment(deployment);

  invariant(checked.ok, 'the harbour deployment is valid');

  const logged: { message: string; error: unknown }[] = [];
  const context = buildQueryContext(store, checked.value);

  const logError = (message: string, error: unknown) => {
    logged.push({ message, error });
  };

  const app = createApp(context, { logError, oauth: null });

  const link = new RPCLink({
    url: '/rpc',
    origin: 'http://pepys.test',

    // RPCLink fixes this option name
    // oxlint-disable-next-line zgeoff/function-verb
    fetch: (url, init) => app.handle(new Request(url, init)),
  });

  const client: DeploymentClient<typeof deployment> = createORPCClient(link);

  return {
    storeDirectory,
    client,
    logged,

    // each call starts the API with its OAuth routes and signs a client in
    callMCP: async (method: string, params: Readonly<Record<string, unknown>>) => {
      const mcp = await startAuthorizedMCP(context, logError);

      return readMCPAnswer(mcp.sendRequest, method, params);
    },
  };
}

test('it logs a call at /rpc that fails on a current file that is not a database', async () => {
  const ctx = await setupTest();

  const directory = join(ctx.storeDirectory, harbourVesselConsumer.name, 'v1');

  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'consumer.db'), 'a page torn in half');
  await writeCurrentVersion(ctx.storeDirectory, harbourVesselConsumer, 'v1');

  await ctx.client.get_entity({ id: 'harbour:vessel:7' }).catch(() => null);

  expect(ctx.logged).toStrictEqual([
    {
      message: 'the /rpc call of get_entity failed',
      error: expect.objectContaining({
        message: expect.stringContaining('File is not a database'),
      }),
    },
  ]);
});

test('it logs a call at /mcp that fails on a current file that is not a database', async () => {
  const ctx = await setupTest();

  const directory = join(ctx.storeDirectory, harbourVesselConsumer.name, 'v1');

  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'consumer.db'), 'a page torn in half');
  await writeCurrentVersion(ctx.storeDirectory, harbourVesselConsumer, 'v1');

  const answer = await ctx.callMCP('tools/call', {
    name: 'get_entity',
    arguments: { id: 'harbour:vessel:7' },
  });

  expect({ answer, logged: ctx.logged }).toStrictEqual({
    answer: { jsonrpc: '2.0', id: 1, result: expect.objectContaining({ isError: true }) },
    logged: [
      {
        message: 'the /mcp call of get_entity failed',
        error: expect.objectContaining({
          message: expect.stringContaining('File is not a database'),
        }),
      },
    ],
  });
});

test('it serves get_entity from the file of the consumer that owns the kind', async () => {
  const ctx = await setupTest();

  await seedHarbourFiles(ctx.storeDirectory);

  const found = await ctx.client.get_entity({ id: 'harbour:voyage:12' });

  expect(found).toStrictEqual({
    entity: {
      id: toTagged<EntityID>('harbour:voyage:12'),
      kind: 'harbour:voyage',
      title: 'harbour:port:north',
      url: null,
      actor: toTagged<EntityID>('harbour:vessel:7'),
      updated_at: '2026-11-02T06:00:00.000Z',
    },
    consumer: 'harbour_voyage',
    table: 'harbour_voyage',
    row: {
      id: 'harbour:voyage:12',
      vessel_id: 'harbour:vessel:7',
      port_id: 'harbour:port:north',
      is_hailed: true,
      departed_at: '2026-11-02T06:00:00.000Z',
    },
  });
});

test('it serves get_entity by an alias from the file of the consumer that holds the alias', async () => {
  const ctx = await setupTest();

  await seedHarbourFiles(ctx.storeDirectory);

  const found = await ctx.client.get_entity({ id: 'Tern' });

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

test('it walks a link in one file to an entity in another', async () => {
  const ctx = await setupTest();

  await seedHarbourFiles(ctx.storeDirectory);

  const near = await ctx.client.neighbourhood({ id: 'harbour:vessel:7' });

  expect(near).toStrictEqual({
    entities: [
      {
        id: toTagged<EntityID>('harbour:vessel:7'),
        kind: 'harbour:vessel',
        title: 'Tern',
        url: null,
        actor: null,
        updated_at: '2026-11-01T08:00:00.000Z',
        depth: 0,
      },
      {
        id: toTagged<EntityID>('harbour:voyage:12'),
        kind: 'harbour:voyage',
        title: 'harbour:port:north',
        url: null,
        actor: toTagged<EntityID>('harbour:vessel:7'),
        updated_at: '2026-11-02T06:00:00.000Z',
        depth: 1,
      },
    ],
    links: [
      {
        type: 'voyage_of',
        from: toTagged<EntityID>('harbour:voyage:12'),
        to: toTagged<EntityID>('harbour:vessel:7'),
        direction: 'incoming',
        origin: 'harbour_voyage',
        confidence: 1,
        depth: 1,
      },
    ],
    unresolved: [],
    skippedConsumers: [],
    isTruncated: false,
  });
});

test('it runs a plug-in query that joins the tables of two files and reads the entity view', async () => {
  const ctx = await setupTest();

  await seedHarbourFiles(ctx.storeDirectory);

  const ports = await ctx.client.harbour_vessel_ports({});

  expect(ports).toStrictEqual({
    ports: [{ name: 'Tern', port: 'harbour:port:north', title: 'harbour:port:north' }],
  });
});

test('it lists every query of the deployment as an MCP tool with its description', async () => {
  const ctx = await setupTest();
  const listed = await ctx.callMCP('tools/list', {});

  expect(listed).toStrictEqual({
    jsonrpc: '2.0',
    id: 1,
    result: {
      tools: [
        expect.objectContaining({ name: 'get_entity', description: expect.any(String) }),
        expect.objectContaining({ name: 'neighbourhood', description: expect.any(String) }),
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
