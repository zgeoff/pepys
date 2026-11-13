import { expect, test } from 'bun:test';
import { join } from 'node:path';
import invariant from 'tiny-invariant';
import { authorizeMCPClient } from '../../test-utils/authorize-mcp-client.ts';
import { readMCPAnswer } from '../../test-utils/read-mcp-answer.ts';
import { startHarbourMCPServer } from '../../test-utils/start-harbour-mcp-server.ts';
import { readJSONRecord } from '../test-utils/read-json-record.ts';
import { setupTempDir } from '../test-utils/setup-temp-dir.ts';

// The API of the harbour deployment with its OAuth routes, its database in
// the test's temp folder, and every security line it prints.
async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-mcp-http-');
  const dbPath = join(temporaryDirectory.path, 'mcp-auth.db');
  const security: string[] = [];

  const startServer = (port: number) =>
    startHarbourMCPServer({
      port,
      dbPath,
      allowedHosts: ['quay.tailnet.example'],
      printSecurity: (line) => {
        security.push(line);
      },
    });

  let server = await startServer(0);

  return {
    dbPath,
    security,
    get url() {
      return server.url;
    },
    get origin() {
      return server.origin;
    },
    readSecurityEvents: (): unknown =>
      JSON.parse(`[${security.map((line) => line.slice('pepys security '.length)).join(',')}]`),
    sendMCPRequest: (token: string, method = 'POST') =>
      fetch(`${server.url}/mcp`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        ...(method === 'POST'
          ? { body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) }
          : {}),
      }),
    authorize: (scopes: readonly string[]) =>
      authorizeMCPClient({ origin: server.origin, dbPath }, scopes),

    // Stops the server and starts a fresh process's worth of it on the same
    // port and database, as an operator's restart does.
    async restartServer(): Promise<void> {
      const port = Number(new URL(server.url).port);

      await server.stop();

      server = await startServer(port);
    },
  };
}

test('it challenges an MCP request with no token for the resource metadata', async () => {
  const ctx = await setupTest();

  const answered = await fetch(`${ctx.url}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });

  expect({
    status: answered.status,
    challenge: answered.headers.get('www-authenticate'),
  }).toStrictEqual({
    status: 401,
    challenge: `Bearer resource_metadata="${ctx.origin}/.well-known/oauth-protected-resource/mcp"`,
  });
});

test('it lists the tools at /mcp to a client that signed in, consented and took a token', async () => {
  const ctx = await setupTest();
  const grant = await ctx.authorize(['read']);

  const listed = await readMCPAnswer(
    (request) =>
      fetch(`${ctx.url}/mcp`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${grant.accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: request.body,
      }),
    'tools/list',
    {},
  );

  expect(listed).toStrictEqual({
    jsonrpc: '2.0',
    id: 1,
    result: {
      tools: expect.arrayContaining([expect.objectContaining({ name: 'get_entity' })]),
    },
  });
});

test('it answers an MCP request at the bare origin as at /mcp', async () => {
  const ctx = await setupTest();
  const grant = await ctx.authorize(['read']);

  const pinged = await fetch(`${ctx.url}/`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${grant.accessToken}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });

  expect(pinged.status).toBe(200);
});

test('it answers an MCP GET with a valid token with 405 and the method it takes', async () => {
  const ctx = await setupTest();
  const grant = await ctx.authorize(['read']);
  const answered = await ctx.sendMCPRequest(grant.accessToken, 'GET');

  expect({ status: answered.status, allow: answered.headers.get('allow') }).toStrictEqual({
    status: 405,
    allow: 'POST',
  });
});

test('it refuses an MCP request with insufficient_scope to a token refreshed without read', async () => {
  const ctx = await setupTest();
  const grant = await ctx.authorize(['read']);

  const refreshed = await fetch(`${ctx.url}/oauth2/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: grant.refreshToken,
      client_id: grant.clientID,
      scope: 'offline_access',
    }),
  });

  const narrowed = await readJSONRecord(refreshed);

  invariant(narrowed['scope'] === 'offline_access', 'the refresh kept read');

  const listed = await ctx.sendMCPRequest(String(narrowed['access_token']));

  expect({
    status: listed.status,
    challenge: listed.headers.get('www-authenticate'),
    body: await listed.json(),
  }).toStrictEqual({
    status: 403,
    challenge: `Bearer error="insufficient_scope", error_description="Insufficient scope", scope="read", resource_metadata="${ctx.origin}/.well-known/oauth-protected-resource/mcp"`,
    body: { error: 'insufficient_scope', error_description: 'Insufficient scope' },
  });
});

test('it refreshes a grant through its token route and serves the new access token', async () => {
  const ctx = await setupTest();
  const grant = await ctx.authorize(['read']);

  const refreshed = await fetch(`${ctx.url}/oauth2/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: grant.refreshToken,
      client_id: grant.clientID,
    }),
  });

  const tokens = await readJSONRecord(refreshed);
  const pinged = await ctx.sendMCPRequest(String(tokens['access_token']));

  expect(pinged.status).toBe(200);
});

test('it serves an MCP request with an access token issued before a restart', async () => {
  const ctx = await setupTest();
  const grant = await ctx.authorize(['read']);

  await ctx.restartServer();

  const pinged = await fetch(`${ctx.url}/mcp`, {
    // A fresh connection, since the restart closed the pooled one.
    keepalive: false,
    method: 'POST',
    headers: {
      authorization: `Bearer ${grant.accessToken}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });

  expect(pinged.status).toBe(200);
});

test('it serves the authorization server metadata with its own origin as the issuer', async () => {
  const ctx = await setupTest();
  const answered = await fetch(`${ctx.url}/.well-known/oauth-authorization-server`);
  const document = await readJSONRecord(answered);

  expect({ status: answered.status, document }).toStrictEqual({
    status: 200,
    document: expect.objectContaining({ issuer: ctx.origin }),
  });
});

test.each([
  ['/.well-known/oauth-protected-resource'],
  ['/.well-known/oauth-protected-resource/mcp'],
])('it serves the resource metadata at %p for its /mcp resource', async (path) => {
  const ctx = await setupTest();
  const answered = await fetch(`${ctx.url}${path}`);
  const document = await readJSONRecord(answered);

  expect({ status: answered.status, document }).toStrictEqual({
    status: 200,
    document: expect.objectContaining({ resource: `${ctx.origin}/mcp` }),
  });
});

test('it serves /rpc under a Host header the OAuth routes refuse', async () => {
  const ctx = await setupTest();

  const answered = await fetch(`${ctx.url}/rpc/get_entity`, {
    method: 'POST',
    headers: { host: 'cluster.example.com', 'content-type': 'application/json' },
    body: JSON.stringify({ json: { id: 'harbour:vessel:404' } }),
  });

  expect(answered.json()).resolves.toMatchObject({ json: { code: 'NOT_FOUND' } });
});

test('it refuses /mcp under a Host header it does not serve and writes it as bad_host', async () => {
  const ctx = await setupTest();

  const answered = await fetch(`${ctx.url}/mcp`, {
    method: 'POST',
    headers: { host: 'cluster.example.com', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });

  expect({ status: answered.status, events: ctx.readSecurityEvents() }).toStrictEqual({
    status: 403,
    events: [expect.objectContaining({ kind: 'bad_host', outcome: 'rejected', route: '/mcp' })],
  });
});

test('it serves the OAuth routes under a further host it is given', async () => {
  const ctx = await setupTest();

  const answered = await fetch(`${ctx.url}/.well-known/oauth-protected-resource/mcp`, {
    headers: { host: 'quay.tailnet.example' },
  });

  expect(answered.status).toBe(200);
});

test('it refuses an MCP request from a browser on another origin and writes it as bad_origin', async () => {
  const ctx = await setupTest();

  const answered = await fetch(`${ctx.url}/mcp`, {
    method: 'POST',
    headers: { origin: 'https://elsewhere.example', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });

  expect({ status: answered.status, events: ctx.readSecurityEvents() }).toStrictEqual({
    status: 403,
    events: [expect.objectContaining({ kind: 'bad_origin', outcome: 'rejected', route: '/mcp' })],
  });
});

test.each([
  [['127.0.0.1'], 'trusted'],
  [['192.0.2.1'], 'unverified'],
])(
  'it marks the forwarded address of a peer when the listed proxies are %p as %p',
  async (proxies, provenance) => {
    const temporaryDirectory = setupTempDir('pepys-mcp-http-');
    const security: string[] = [];

    const server = await startHarbourMCPServer({
      dbPath: join(temporaryDirectory.path, 'mcp-auth.db'),
      trustForwardedFrom: proxies,
      printSecurity: (line) => {
        security.push(line);
      },
    });

    await fetch(`${server.url}/mcp`, {
      method: 'POST',
      headers: { host: 'cluster.example.com', 'cf-connecting-ip': '198.51.100.23' },
    });

    const events: unknown = JSON.parse(
      `[${security.map((line) => line.slice('pepys security '.length)).join(',')}]`,
    );

    expect(events).toMatchObject([
      {
        kind: 'bad_host',
        peer: { address: '127.0.0.1', provenance: 'socket' },
        forwarded: { address: '198.51.100.23', header: 'cf-connecting-ip', provenance },
      },
    ]);
  },
);

test.each([
  ['0.0.0.0', null],
  ['0.0.0.0', 'http://localhost:8414'],
  ['192.168.1.10', null],
])('it refuses to listen on %p with the public URL %p', (host, publicURL) => {
  const temporaryDirectory = setupTempDir('pepys-mcp-http-');

  const started = startHarbourMCPServer({
    host,
    publicURL,
    dbPath: join(temporaryDirectory.path, 'mcp-auth.db'),
  });

  expect(started).rejects.toThrow(/needs an https public URL/u);
});

test('it listens beyond loopback behind an https public URL', async () => {
  const temporaryDirectory = setupTempDir('pepys-mcp-http-');

  const listening = await startHarbourMCPServer({
    host: '0.0.0.0',
    publicURL: 'https://mcp.example.com',
    dbPath: join(temporaryDirectory.path, 'mcp-auth.db'),
  });

  expect({ origin: listening.origin, listening: listening.listening }).toStrictEqual({
    origin: 'https://mcp.example.com',
    listening: expect.stringMatching(/^http:\/\/0\.0\.0\.0:\d+$/u),
  });
});
