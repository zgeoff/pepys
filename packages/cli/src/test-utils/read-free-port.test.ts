import { expect, onTestFinished, test } from 'bun:test';
import { readFreePort } from './read-free-port.ts';

test('it returns a port that a listener can then bind', () => {
  const port = readFreePort();
  const listener = Bun.listen({ hostname: '127.0.0.1', port, socket: { data: () => {} } });

  onTestFinished(() => listener.stop(true));

  expect(listener.port).toBe(port);
});
