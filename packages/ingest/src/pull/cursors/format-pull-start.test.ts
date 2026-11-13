import { expect, test } from 'bun:test';
import { formatPullStart } from './format-pull-start.ts';

test.each([
  {
    cursor: '31847002219',
    line: 'pull github recovery {"source":"github","path":"recovery","cursor":"saved"}',
  },
  {
    cursor: null,
    line: 'pull github recovery {"source":"github","path":"recovery","cursor":"none"}',
  },
])('it names the source and the pull path, and never the value, of the cursor $cursor', (row) => {
  const line = formatPullStart({
    source: 'github',
    path: 'recovery',
    intervalMs: 3_600_000,
    cursor: row.cursor,
  });

  expect(line).toBe(row.line);
});
