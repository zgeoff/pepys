import { expect, test } from 'bun:test';
import { formatRunPrefix } from './format-run-prefix.ts';

test('it formats the prefix from the PID and the PID namespace', () => {
  expect(formatRunPrefix(4182, '4026531836')).toBe('pid4182-ns4026531836-');
});
