import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { waitFor } from '@zgeoff/testing/helpers';
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

test('it gives a service client in its service-token file an access token that /mcp serves', async () => {
  const temporaryDirectory = setupTempDir('pepys-mcp-http-');
  const serviceTokensFile = join(temporaryDirectory.path, 'service-tokens.json');

  await Bun.write(
    serviceTokensFile,
    JSON.stringify({
      resource: 'https://quay.example/mcp',
      clients: {
        'quay-reader': {
          scopes: ['read'],
          secretDigests: ['edcf76230c5f263afc457c110b580af491e99729113b05a3dfbf1b90d52b8ceb'],
        },
      },
    }),
  );

  const server = await startHarbourMCPServer({
    publicURL: 'https://quay.example',
    dbPath: join(temporaryDirectory.path, 'mcp-auth.db'),
    serviceTokensFile,
  });

  const issued = await fetch(`${server.url}/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa('service:quay-reader:svcs_quayreaderquayreaderquayreaderquay01')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=read',
  });

  const token = await readJSONRecord(issued);

  invariant(typeof token['access_token'] === 'string', 'the token route issued an access token');

  const pinged = await fetch(`${server.url}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token['access_token']}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });

  expect(pinged.status).toBe(200);
});

test('it refuses the last service client once SIGHUP reloads a file that names none', async () => {
  const temporaryDirectory = setupTempDir('pepys-mcp-http-');
  const serviceTokensFile = join(temporaryDirectory.path, 'service-tokens.json');
  const basic = `Basic ${btoa('service:quay-reader:svcs_quayreaderquayreaderquayreaderquay01')}`;

  await Bun.write(
    serviceTokensFile,
    JSON.stringify({
      resource: 'https://quay.example/mcp',
      clients: {
        'quay-reader': {
          scopes: ['read'],
          secretDigests: ['edcf76230c5f263afc457c110b580af491e99729113b05a3dfbf1b90d52b8ceb'],
        },
      },
    }),
  );

  const server = await startHarbourMCPServer({
    publicURL: 'https://quay.example',
    dbPath: join(temporaryDirectory.path, 'mcp-auth.db'),
    serviceTokensFile,
  });

  const exchange = () =>
    fetch(`${server.url}/oauth2/token`, {
      method: 'POST',
      headers: { authorization: basic, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials&scope=read',
    });

  const exchanged = await exchange();
  const issued = await readJSONRecord(exchanged);

  invariant(typeof issued['access_token'] === 'string', 'the token route issued an access token');

  const accessToken = issued['access_token'];

  await Bun.write(
    serviceTokensFile,
    JSON.stringify({ resource: 'https://quay.example/mcp', clients: {} }),
  );

  process.kill(process.pid, 'SIGHUP');

  await waitFor(async () => {
    const pinged = await fetch(`${server.url}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });

    expect(pinged.status).toBe(401);
  });

  const refused = await exchange();

  // with no client that holds a secret, the package stops offering the grant at all
  expect({ status: refused.status, body: await readJSONRecord(refused) }).toStrictEqual({
    status: 400,
    body: expect.objectContaining({ error: 'unsupported_grant_type' }),
  });
});

test.each([
  { client: 'service:dock-reader', secret: 'svcs_quayreaderquayreaderquayreaderquay01' },
  { client: 'service:quay-reader', secret: 'svcs_dockreaderdockreaderdockreaderdock01' },
])('it refuses a client_credentials request from $client with invalid_client', async (row) => {
  const temporaryDirectory = setupTempDir('pepys-mcp-http-');
  const serviceTokensFile = join(temporaryDirectory.path, 'service-tokens.json');

  await Bun.write(
    serviceTokensFile,
    JSON.stringify({
      resource: 'https://quay.example/mcp',
      clients: {
        'quay-reader': {
          scopes: ['read'],
          secretDigests: ['edcf76230c5f263afc457c110b580af491e99729113b05a3dfbf1b90d52b8ceb'],
        },
      },
    }),
  );

  const server = await startHarbourMCPServer({
    publicURL: 'https://quay.example',
    dbPath: join(temporaryDirectory.path, 'mcp-auth.db'),
    serviceTokensFile,
  });

  const refused = await fetch(`${server.url}/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${row.client}:${row.secret}`)}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=read',
  });

  expect({ status: refused.status, body: await readJSONRecord(refused) }).toStrictEqual({
    status: 401,
    body: expect.objectContaining({ error: 'invalid_client' }),
  });
});

test.each([
  { problem: 'is not JSON', text: '{"resource":' },
  {
    problem: 'names another resource',
    text: JSON.stringify({
      resource: 'https://other.example/mcp',
      clients: {
        'quay-reader': {
          scopes: ['read'],
          secretDigests: ['edcf76230c5f263afc457c110b580af491e99729113b05a3dfbf1b90d52b8ceb'],
        },
      },
    }),
  },
  {
    problem: 'holds a static token',
    text: JSON.stringify({
      resource: 'https://quay.example/mcp',
      clients: {
        'quay-reader': { scopes: ['read'], tokens: ['pepys_svc_quayreaderquayreaderquayreader01'] },
      },
    }),
  },
])('it refuses to start with a service-token file that $problem', async (row) => {
  const temporaryDirectory = setupTempDir('pepys-mcp-http-');
  const serviceTokensFile = join(temporaryDirectory.path, 'service-tokens.json');

  await Bun.write(serviceTokensFile, row.text);

  const started = startHarbourMCPServer({
    publicURL: 'https://quay.example',
    dbPath: join(temporaryDirectory.path, 'mcp-auth.db'),
    serviceTokensFile,
  });

  expect(started).rejects.toThrow(/service.token file/u);
});
