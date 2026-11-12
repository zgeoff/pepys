import { expect, test } from 'bun:test';
import { checkDeployment, defineDeployment } from '@pepys/kit';
import { createTestStore } from '@pepys/testing';
import invariant from 'tiny-invariant';
import { registerTestCleanup } from '../oauth/test-utils/register-test-cleanup.ts';
import { buildQueryContext } from '../queries/build-query-context.ts';
import { harbourPlugin, harbourSource } from './harbour/harbour-plugin.ts';
import { startAuthorizedMCP } from './start-authorized-mcp.ts';

async function setupTest() {
  const checked = checkDeployment(defineDeployment({ name: 'harbour', plugins: [harbourPlugin] }));

  invariant(checked.ok, 'the harbour deployment is valid');

  const store = await createTestStore({ plugins: [harbourPlugin] });

  registerTestCleanup(() => store[Symbol.asyncDispose]());

  const mcp = await startAuthorizedMCP(buildQueryContext(store.reader, checked.value), () => {});

  return { store, mcp };
}

test('it sends a request with the read token to its server, whatever origin the request names', async () => {
  const ctx = await setupTest();

  await ctx.store.apply(harbourSource, [
    {
      type: 'harbour.voyage.departed',
      event: 'evt-51',
      entity: 'harbour:voyage:30',
      at: '2026-11-06T06:00:00.000Z',
      payload: { vessel: 'harbour:vessel:9', port: 'harbour:port:east', confidence: 1 },
    },
  ]);

  const answered = await ctx.mcp.sendRequest(
    new Request('http://elsewhere.example/mcp?probe=1', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'harbour_voyage_count', arguments: { vessel: 'harbour:vessel:9' } },
      }),
    }),
  );

  const text = await answered.text();

  expect({ status: answered.status, text }).toStrictEqual({
    status: 200,
    text: expect.stringContaining(String.raw`\"count\":1`),
  });
});

test('it replaces an authorization the request carries with its own token', async () => {
  const ctx = await setupTest();

  const answered = await ctx.mcp.sendRequest(
    new Request('http://elsewhere.example/mcp', {
      method: 'POST',
      headers: {
        authorization: 'Bearer stale-token',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }),
  );

  expect(answered.status).toBe(200);
});
