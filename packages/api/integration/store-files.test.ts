import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { checkDeployment, defineDeployment } from '@pepys/kit';
import invariant from 'tiny-invariant';
import { createApp } from '../src/app/create-app.ts';
import type { DeploymentClient } from '../src/client/deployment-client.ts';
import { buildQueryContext } from '../src/queries/build-query-context.ts';
import { createStoreReader } from '../src/store-reader/create-store-reader.ts';
import { writeCurrentVersion } from '../src/test-utils/create-consumer-version.ts';
import { harbourPlugin, harbourVesselConsumer } from '../src/test-utils/harbour/harbour-plugin.ts';
import { seedHarbourFiles } from '../src/test-utils/harbour/seed-harbour-files.ts';
import { readMCPAnswer } from '../src/test-utils/read-mcp-answer.ts';

async function setupTest() {
  const deployment = defineDeployment({ name: 'harbour', plugins: [harbourPlugin] });

  const storeDirectory = await mkdtemp(join(tmpdir(), 'pepys-api-files-'));

  onTestFinished(() => rm(storeDirectory, { recursive: true, force: true }));

  const store = createStoreReader({ storeDirectory });

  onTestFinished(() => store.close());

  const checked = checkDeployment(deployment);

  invariant(checked.ok, 'the harbour deployment is valid');

  const logged: { message: string; error: unknown }[] = [];

  const app = createApp(buildQueryContext(store, checked.value), {
    logError: (message, error) => {
      logged.push({ message, error });
    },
  });

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
    listTools: () => readMCPAnswer((request) => app.handle(request), 'tools/list', {}),
    callMCP: (method: string, params: Readonly<Record<string, unknown>>) =>
      readMCPAnswer((request) => app.handle(request), method, params),
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
      id: 'harbour:voyage:12',
      kind: 'harbour:voyage',
      title: 'harbour:port:north',
      url: null,
      actor: 'harbour:vessel:7',
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

test('it walks a link in one file to an entity in another', async () => {
  const ctx = await setupTest();

  await seedHarbourFiles(ctx.storeDirectory);

  const near = await ctx.client.neighbourhood({ id: 'harbour:vessel:7' });

  expect(near).toStrictEqual({
    entities: [
      {
        id: 'harbour:vessel:7',
        kind: 'harbour:vessel',
        title: 'Tern',
        url: null,
        actor: null,
        updated_at: '2026-11-01T08:00:00.000Z',
        depth: 0,
      },
      {
        id: 'harbour:voyage:12',
        kind: 'harbour:voyage',
        title: 'harbour:port:north',
        url: null,
        actor: 'harbour:vessel:7',
        updated_at: '2026-11-02T06:00:00.000Z',
        depth: 1,
      },
    ],
    links: [
      {
        type: 'voyage_of',
        from: 'harbour:voyage:12',
        to: 'harbour:vessel:7',
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
  const listed = await ctx.listTools();

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
