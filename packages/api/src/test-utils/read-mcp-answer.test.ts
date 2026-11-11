import { expect, test } from 'bun:test';
import { readMCPAnswer } from './read-mcp-answer.ts';

test.each([
  ['an event stream', 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\n'],
  ['a JSON body', '{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}'],
])('it parses the answer from %s', async (_case, body) => {
  const answer = await readMCPAnswer(() => Promise.resolve(new Response(body)), 'tools/list', {});

  expect(answer).toStrictEqual({ jsonrpc: '2.0', id: 1, result: { tools: [] } });
});

test('it posts one JSON-RPC request that accepts JSON and an event stream', async () => {
  const sent: Request[] = [];

  await readMCPAnswer(
    (request) => {
      sent.push(request);

      return Promise.resolve(new Response('{}'));
    },
    'tools/call',
    { name: 'get_entity' },
  );

  const [request] = sent;

  const body: unknown = await request?.json();

  expect({
    method: request?.method,
    url: request?.url,
    accept: request?.headers.get('accept'),
    body,
  }).toStrictEqual({
    method: 'POST',
    url: 'http://pepys.test/mcp',
    accept: 'application/json, text/event-stream',
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_entity' } },
  });
});
