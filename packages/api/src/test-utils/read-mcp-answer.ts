type HandleRequest = (request: Request) => Promise<Response>;

// Sends one JSON-RPC request to /mcp through an app's request handler, and returns the parsed
// answer. The handler answers a request as a server-sent event stream of one message.
export async function readMCPAnswer(
  handleRequest: HandleRequest,
  method: string,
  params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const response = await handleRequest(
    new Request('http://pepys.test/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );

  const text = await response.text();

  const data = text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice('data: '.length))
    .join('');

  const json = data === '' ? text : data;
  const answer: unknown = JSON.parse(json);

  return answer;
}
