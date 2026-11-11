import { expect, test } from 'bun:test';
import { githubPullRequestConsumer } from '@pepys/source-github';
import { findEntityConsumer } from './find-entity-consumer.ts';

test('it finds the consumer whose source and view kind match the entity', () => {
  const found = findEntityConsumer([githubPullRequestConsumer], {
    source: 'github',
    kind: 'pr',
    id: '5',
  });

  expect(found?.consumer.name).toBe('github_pull_request');
  expect(found?.entityView.table).toBe('github_pull_request');
});

test('it finds nothing for a kind no consumer serves', () => {
  expect(
    findEntityConsumer([githubPullRequestConsumer], { source: 'github', kind: 'issue', id: '5' }),
  ).toBeUndefined();
});

test('it finds nothing for a source no consumer reads', () => {
  expect(
    findEntityConsumer([githubPullRequestConsumer], { source: 'linear', kind: 'pr', id: '5' }),
  ).toBeUndefined();
});
