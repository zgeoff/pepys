import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { setupTempDir } from '../oauth/test-utils/setup-temp-dir.ts';
import { startHarbourMCPServer } from './start-harbour-mcp-server.ts';

function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-start-harbour-mcp-server-');

  return { dbPath: join(temporaryDirectory.path, 'mcp-auth.db') };
}

test('it serves the queries of the harbour deployment on a loopback port', async () => {
  const ctx = setupTest();

  const server = await startHarbourMCPServer({ dbPath: ctx.dbPath });

  const answered = await fetch(`${server.url}/rpc/harbour_voyage_count`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { vessel: 'harbour:vessel:7' } }),
  });

  const answer = { url: server.url, body: await answered.json() };

  expect(answer).toStrictEqual({
    url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/u),
    body: { json: { count: 0 } },
  });
});

test('it serves its OAuth routes with the server defaults', async () => {
  const ctx = setupTest();

  const server = await startHarbourMCPServer({ dbPath: ctx.dbPath });
  const answered = await fetch(`${server.url}/.well-known/oauth-protected-resource/mcp`);

  expect(answered.status).toBe(200);
});

test('it starts the server with an option the test sets', async () => {
  const ctx = setupTest();

  const server = await startHarbourMCPServer({
    dbPath: ctx.dbPath,
    allowedHosts: ['quay.tailnet.example'],
  });

  const answered = await fetch(`${server.url}/.well-known/oauth-protected-resource/mcp`, {
    headers: { host: 'quay.tailnet.example' },
  });

  expect(answered.status).toBe(200);
});

test('it keeps to the default hosts when the test sets none', async () => {
  const ctx = setupTest();

  const server = await startHarbourMCPServer({ dbPath: ctx.dbPath });

  const answered = await fetch(`${server.url}/.well-known/oauth-protected-resource/mcp`, {
    headers: { host: 'quay.tailnet.example' },
  });

  expect(answered.status).toBe(403);
});
