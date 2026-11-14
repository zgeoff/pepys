import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { openSharedAuth } from '../../test-utils/open-shared-auth.ts';
import { setupTempDir } from '../test-utils/setup-temp-dir.ts';
import { reloadServiceTokens } from './reload-service-tokens.ts';

// An auth core that starts with one service client, `quay-reader`, and its static token, which
// `verify` checks with no token exchange, and the path of a service-token file that the test writes.
async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-service-tokens-');
  const filePath = join(temporaryDirectory.path, 'service-tokens.json');

  const auth = await openSharedAuth({
    origin: 'https://quay.example',
    dbPath: join(temporaryDirectory.path, 'mcp-auth.db'),
    serviceTokens: {
      prefix: 'pepys_svc_',
      file: {
        resource: 'https://quay.example/mcp',
        clients: [
          {
            name: 'quay-reader',
            scopes: ['read'],
            tokens: ['pepys_svc_quayreaderquayreaderquayreader01'],
          },
        ],
      },
    },
  });

  return {
    filePath,
    writeFile: (text: string) => Bun.write(filePath, text),
    reload: () => reloadServiceTokens(auth, filePath),
    verify: (bearer: string) => auth.verify(bearer),
  };
}

test('it replaces the service clients with those of a valid file', async () => {
  const ctx = await setupTest();

  await ctx.writeFile(
    JSON.stringify({
      resource: 'https://quay.example/mcp',
      clients: {
        'dock-reader': {
          scopes: ['read'],
          secretDigests: ['8f5dce3101b35b758cca5d0a431e6cbbf9619a6614d38cbdc7d5294db5a06804'],
        },
      },
    }),
  );

  const reload = await ctx.reload();

  expect(reload).toStrictEqual({ kind: 'replaced', clients: 1 });
});

test('it refuses a client that the reloaded file drops', async () => {
  const ctx = await setupTest();

  await ctx.writeFile(
    JSON.stringify({
      resource: 'https://quay.example/mcp',
      clients: {
        'dock-reader': {
          scopes: ['read'],
          secretDigests: ['8f5dce3101b35b758cca5d0a431e6cbbf9619a6614d38cbdc7d5294db5a06804'],
        },
      },
    }),
  );

  await ctx.reload();

  const dropped = await ctx.verify('pepys_svc_quayreaderquayreaderquayreader01');

  expect(dropped).toBeNull();
});

test('it revokes the last service client when the reloaded file names none', async () => {
  const ctx = await setupTest();

  await ctx.writeFile(JSON.stringify({ resource: 'https://quay.example/mcp', clients: {} }));

  const reload = await ctx.reload();

  expect({
    reload,
    dropped: await ctx.verify('pepys_svc_quayreaderquayreaderquayreader01'),
  }).toStrictEqual({ reload: { kind: 'replaced', clients: 0 }, dropped: null });
});

test.each([
  { problem: 'not JSON', text: '{"resource":' },
  {
    problem: 'a client with an unknown scope',
    text: JSON.stringify({
      resource: 'https://quay.example/mcp',
      clients: {
        'dock-reader': {
          scopes: ['write'],
          secretDigests: ['8f5dce3101b35b758cca5d0a431e6cbbf9619a6614d38cbdc7d5294db5a06804'],
        },
      },
    }),
  },
  {
    problem: 'a client with a static token',
    text: JSON.stringify({
      resource: 'https://quay.example/mcp',
      clients: {
        'dock-reader': { scopes: ['read'], tokens: ['pepys_svc_dockreaderdockreaderdockreader01'] },
      },
    }),
  },
  {
    problem: 'another resource',
    text: JSON.stringify({
      resource: 'https://other.example/mcp',
      clients: {
        'dock-reader': {
          scopes: ['read'],
          secretDigests: ['8f5dce3101b35b758cca5d0a431e6cbbf9619a6614d38cbdc7d5294db5a06804'],
        },
      },
    }),
  },
  {
    problem: 'no clients for another resource',
    text: JSON.stringify({ resource: 'https://other.example/mcp', clients: {} }),
  },
])('it keeps the old service clients when the new file holds $problem', async (row) => {
  const ctx = await setupTest();

  await ctx.writeFile(row.text);

  const reload = await ctx.reload();

  expect({
    reload,
    kept: await ctx.verify('pepys_svc_quayreaderquayreaderquayreader01'),
  }).toStrictEqual({
    reload: { kind: 'kept', reason: expect.any(String) },
    kept: {
      kind: 'service',
      clientID: 'service:quay-reader',
      clientName: 'service:quay-reader',
      scopes: ['read'],
    },
  });
});

test('it keeps the old service clients when the file is gone', async () => {
  const ctx = await setupTest();
  const reload = await ctx.reload();

  expect({
    reload,
    kept: await ctx.verify('pepys_svc_quayreaderquayreaderquayreader01'),
  }).toStrictEqual({
    reload: { kind: 'kept', reason: 'the file cannot be read (ENOENT)' },
    kept: {
      kind: 'service',
      clientID: 'service:quay-reader',
      clientName: 'service:quay-reader',
      scopes: ['read'],
    },
  });
});

test.each([
  { problem: 'a malformed token', token: 'pepys_svc_leakleak' },
  { problem: 'a well-formed token', token: 'pepys_svc_leakleakleakleakleakleakleakleak01' },
])('it never quotes $problem of a file it refuses', async (row) => {
  const ctx = await setupTest();

  await ctx.writeFile(
    JSON.stringify({
      resource: 'https://quay.example/mcp',
      clients: { 'dock-reader': { scopes: ['read'], tokens: [row.token] } },
    }),
  );

  const reload = await ctx.reload();

  expect(JSON.stringify(reload)).not.toContain(row.token);
});
