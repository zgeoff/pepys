import { expect, test } from 'bun:test';
import { formatSHA256Sums } from './format-sha256-sums.ts';

test('it writes one sha256sum line per file, with two spaces before the bare name', () => {
  const text = formatSHA256Sums([
    { name: 'pepys-host-linux-x64', sha256: 'a'.repeat(64) },
    { name: 'notes.txt', sha256: 'b'.repeat(64) },
  ]);

  expect(text).toBe(`${'a'.repeat(64)}  pepys-host-linux-x64\n${'b'.repeat(64)}  notes.txt\n`);
});
