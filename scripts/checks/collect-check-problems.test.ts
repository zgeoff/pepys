import { expect, test } from 'bun:test';
import { collectCheckProblems } from './collect-check-problems.ts';

test.each([
  ['nothing when every job succeeded or was skipped', 'success skipped success', []],
  ['nothing for extra spaces between results', ' success  skipped ', []],
  [
    'each result that is no success and no skip',
    'success failure cancelled',
    ['a required job ended as failure', 'a required job ended as cancelled'],
  ],
  ['the empty list for no results', '', ['RESULTS holds no job results']],
  ['the empty list for only spaces', '   ', ['RESULTS holds no job results']],
])('it gives %s', (_title, results, expected) => {
  expect(collectCheckProblems(results)).toStrictEqual(expected);
});
