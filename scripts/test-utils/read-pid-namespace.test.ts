import { expect, test } from 'bun:test';
import { readlink } from 'node:fs/promises';
import { readPIDNamespace } from './read-pid-namespace.ts';

test('it reads the number of the PID namespace the process runs in', async () => {
  const link = await readlink('/proc/self/ns/pid');
  const namespace = await readPIDNamespace();

  expect(`pid:[${namespace}]`).toBe(link);
});
