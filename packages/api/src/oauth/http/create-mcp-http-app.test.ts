import { expect, mock, test } from 'bun:test';
import type { McpHttpHandler } from '@modelcontextprotocol/server';
import type { SecurityEvent } from '../auth/types.ts';
import { createMCPHTTPApp } from './create-mcp-http-app.ts';

// The app before the authorization server opens: the Host check runs
// without a context, so no database is wired.
function setupTest() {
  const record = mock<(event: SecurityEvent) => void>();
  const fetchMCP = mock<McpHttpHandler['fetch']>();

  const app = createMCPHTTPApp({
    hosts: new Set(['127.0.0.1:4100']),
    origins: new Set(['http://127.0.0.1:4100']),
    readContext: () => null,
    readRequester: () => ({ socketAddress: '127.0.0.1', connectingIP: null, userAgent: 'curl/8' }),
    security: { record },
    mcp: { fetch: fetchMCP },
    besidePrefix: '/rpc/',
  });

  return { app, record, fetchMCP };
}

test('it refuses a token request whose Host header it does not serve and records it', async () => {
  const ctx = setupTest();

  const answered = await ctx.app.handle(
    new Request('http://127.0.0.1:4100/oauth2/token', {
      method: 'POST',
      headers: { host: 'rebound.example' },
      body: 'grant_type=authorization_code',
    }),
  );

  expect(answered.status).toBe(403);

  expect(ctx.record).toHaveBeenCalledExactlyOnceWith({
    kind: 'authorize_invalid',
    outcome: 'rejected',
    reason: 'bad_host',
    path: '/oauth2/token',
    requester: { socketAddress: '127.0.0.1', connectingIP: null, userAgent: 'curl/8' },
  });
});

test('it refuses an MCP request whose Host header it does not serve before the MCP route runs', async () => {
  const ctx = setupTest();

  const answered = await ctx.app.handle(
    new Request('http://127.0.0.1:4100/mcp', {
      method: 'POST',
      headers: { host: 'rebound.example' },
      body: '{"jsonrpc":"2.0","id":1,"method":"ping"}',
    }),
  );

  expect(answered.status).toBe(403);
  expect(ctx.fetchMCP).not.toHaveBeenCalled();
});

test('it answers a served Host with 503 while the authorization server is not open', async () => {
  const ctx = setupTest();

  const answered = await ctx.app.handle(
    new Request('http://127.0.0.1:4100/.well-known/oauth-authorization-server', {
      headers: { host: '127.0.0.1:4100' },
    }),
  );

  expect(answered.status).toBe(503);
  expect(ctx.record).not.toHaveBeenCalled();
});
