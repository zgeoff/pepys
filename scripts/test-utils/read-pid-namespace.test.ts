import { expect, test } from 'bun:test';
import { readPIDNamespace } from './read-pid-namespace.ts';

test('it reads the namespace number from the link of the process PID namespace', async () => {
  const namespace = await readPIDNamespace(() => Promise.resolve('pid:[4026531836]'));

  expect(namespace).toBe('4026531836');
});

test('it throws on a link that names no PID namespace', () => {
  expect(readPIDNamespace(() => Promise.resolve('net:[4026531840]'))).rejects.toThrow(
    'unexpected PID namespace link: net:[4026531840]',
  );
});
