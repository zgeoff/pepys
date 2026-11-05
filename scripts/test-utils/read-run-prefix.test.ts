import { expect, test } from 'bun:test';
import { readRunPrefix } from './read-run-prefix.ts';

test('it builds the prefix from the PID and the PID namespace the link names', async () => {
  const prefix = await readRunPrefix(() => Promise.resolve('pid:[4026531836]'), 4182);

  expect(prefix).toBe('pid4182-ns4026531836-');
});

test('it builds a prefix with no namespace number on a host with no PID namespace', async () => {
  const prefix = await readRunPrefix(
    () => Promise.reject(Object.assign(new Error('no such file'), { code: 'ENOENT' })),
    4182,
  );

  expect(prefix).toBe('pid4182-nsnone-');
});
