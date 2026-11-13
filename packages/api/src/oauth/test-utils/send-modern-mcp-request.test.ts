import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { startHarbourMCPServer } from '../../test-utils/start-harbour-mcp-server.ts';
import { openMCPAuthDatabase } from '../admin/open-mcp-auth-database.ts';
import { openMCPAuth } from '../auth/open-mcp-auth.ts';
import { systemClock } from '../auth/system-clock.ts';
import { buildEnrolledPasskeySeeder } from './build-enrolled-passkey-seeder.ts';
import { buildStubAuthenticator } from './build-stub-authenticator.ts';
import { registerTestCleanup } from './register-test-cleanup.ts';
import { runMCPTokenGrant } from './run-mcp-token-grant.ts';
import { sendModernMCPRequest } from './send-modern-mcp-request.ts';
import { setupTempDir } from './setup-temp-dir.ts';

async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-send-modern-mcp-request-');
  const dbPath = join(temporaryDirectory.path, 'mcp-auth.db');

  const server = await startHarbourMCPServer({
    dbPath,
  });

  const store = await openMCPAuth({ dbPath, openDatabase: openMCPAuthDatabase, origin: null });

  registerTestCleanup(() => store.close());

  const authenticator = buildStubAuthenticator();

  return {
    url: server.url,
    origin: server.origin,
    authenticator,
    store,
    seed: buildEnrolledPasskeySeeder({ db: store.db, clock: systemClock, server }),
  };
}

test('it sends a request the server serves in the stateless revision', async () => {
  const ctx = await setupTest();

  await ctx.seed.enrolledPasskey({ authenticator: ctx.authenticator });

  const created = await ctx.store.auth.api.createFixedClient({
    body: { name: 'dots', redirectURIs: ['https://dots.example/cb'] },
  });

  const grant = await runMCPTokenGrant(ctx, {
    clientID: created.clientID,
    redirectURI: 'https://dots.example/cb',
    scope: 'read',
    ticked: ['read'],
  });

  const answer = await sendModernMCPRequest(ctx.url, grant.accessToken, 'server/discover');

  expect(answer.status).toBe(200);

  expect(answer.body).toStrictEqual({
    jsonrpc: '2.0',
    id: 1,
    result: {
      resultType: 'complete',
      supportedVersions: ['2026-07-28'],
      capabilities: { tools: { listChanged: true } },
      cacheScope: 'private',
      ttlMs: 0,
      _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'pepys-harbour', version: '1.0.0' } },
    },
  });
});

test('it names the tool of a tool call in its headers, as the stateless revision requires', async () => {
  const ctx = await setupTest();

  await ctx.seed.enrolledPasskey({ authenticator: ctx.authenticator });

  const created = await ctx.store.auth.api.createFixedClient({
    body: { name: 'dots', redirectURIs: ['https://dots.example/cb'] },
  });

  const grant = await runMCPTokenGrant(ctx, {
    clientID: created.clientID,
    redirectURI: 'https://dots.example/cb',
    scope: 'read',
    ticked: ['read'],
  });

  const answer = await sendModernMCPRequest(ctx.url, grant.accessToken, 'tools/call', {
    name: 'harbour_voyage_count',
    arguments: { vessel: 'harbour:vessel:7' },
  });

  expect(answer.status).toBe(200);

  expect(answer.body).toStrictEqual({
    jsonrpc: '2.0',
    id: 1,
    result: {
      resultType: 'complete',
      content: [{ type: 'text', text: '{"count":0}' }],
      structuredContent: { count: 0 },
      _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'pepys-harbour', version: '1.0.0' } },
    },
  });
});
