import { expect, test } from 'bun:test';
import { startStubServer } from '@zgeoff/testing/server';
import { HttpResponse, http } from 'msw';
import { mockNetwork } from './mock-network.ts';

test('it answers a request to a remote host from the handler a test gives it', async () => {
  mockNetwork.use(http.get('https://remote.example/ping', () => HttpResponse.json({ ok: true })));

  const response = await fetch('https://remote.example/ping');
  const body = await response.json();

  expect(body).toStrictEqual({ ok: true });
});

test('it lets a request to a loopback server through', async () => {
  const server = startStubServer(() => Response.json({ from: 'stub' }));

  const response = await fetch(`${server.url}/ping`);
  const body = await response.json();

  expect(body).toStrictEqual({ from: 'stub' });
  expect(server.requests.map((request) => request.path)).toStrictEqual(['/ping']);
});
