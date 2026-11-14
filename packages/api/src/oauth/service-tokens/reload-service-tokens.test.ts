import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { openSharedAuth } from '../../test-utils/open-shared-auth.ts';
import { setupTempDir } from '../test-utils/setup-temp-dir.ts';
import { reloadServiceTokens } from './reload-service-tokens.ts';

// An auth core that starts with one service client, `quay-reader`, and its static token, and the
// path of a service-token file in the test's temp folder that the test writes.
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
        'dock-reader': { scopes: ['read'], tokens: ['pepys_svc_dockreaderdockreaderdockreader01'] },
      },
    }),
  );

  const reload = await ctx.reload();

  expect(reload).toStrictEqual({ kind: 'replaced', clients: 1 });
});

test('it serves a client the reloaded file adds, and refuses the one it drops', async () => {
  const ctx = await setupTest();

  await ctx.writeFile(
    JSON.stringify({
      resource: 'https://quay.example/mcp',
      clients: {
        'dock-reader': { scopes: ['read'], tokens: ['pepys_svc_dockreaderdockreaderdockreader01'] },
      },
    }),
  );

  await ctx.reload();

  expect({
    added: await ctx.verify('pepys_svc_dockreaderdockreaderdockreader01'),
    dropped: await ctx.verify('pepys_svc_quayreaderquayreaderquayreader01'),
  }).toStrictEqual({
    added: {
      kind: 'service',
      clientID: 'service:dock-reader',
      clientName: 'service:dock-reader',
      scopes: ['read'],
    },
    dropped: null,
  });
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
          tokens: ['pepys_svc_dockreaderdockreaderdockreader01'],
        },
      },
    }),
  },
  {
    problem: 'a token without the prefix',
    text: JSON.stringify({
      resource: 'https://quay.example/mcp',
      clients: {
        'dock-reader': { scopes: ['read'], tokens: ['svca_dockreaderdockreaderdockreader01'] },
      },
    }),
  },
  {
    problem: 'another resource',
    text: JSON.stringify({
      resource: 'https://other.example/mcp',
      clients: {
        'dock-reader': { scopes: ['read'], tokens: ['pepys_svc_dockreaderdockreaderdockreader01'] },
      },
    }),
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

test('it never quotes a token of a file it refuses', async () => {
  const ctx = await setupTest();

  await ctx.writeFile(
    JSON.stringify({
      resource: 'https://quay.example/mcp',
      clients: { 'dock-reader': { scopes: ['read'], tokens: ['pepys_svc_leakleak'] } },
    }),
  );

  const reload = await ctx.reload();

  expect(JSON.stringify(reload)).not.toContain('pepys_svc_leakleak');
});
