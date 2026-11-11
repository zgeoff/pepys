import { expect, test } from 'bun:test';
import { stubPullRequestConsumer } from '../../test-utils/stub-pull-request-consumer.ts';
import { findEntityConsumer } from './find-entity-consumer.ts';

test('it finds the consumer whose source and view kind match the entity', () => {
  const found = findEntityConsumer([stubPullRequestConsumer], {
    source: 'github',
    kind: 'pull_request',
    id: '5',
  });

  expect(found?.consumer.name).toBe('github_pull_request');
  expect(found?.entityView.table).toBe('github_pull_request');
});

test('it finds nothing for a kind no consumer serves', () => {
  expect(
    findEntityConsumer([stubPullRequestConsumer], { source: 'github', kind: 'issue', id: '5' }),
  ).toBeUndefined();
});

test('it finds nothing for a source no consumer reads', () => {
  expect(
    findEntityConsumer([stubPullRequestConsumer], {
      source: 'linear',
      kind: 'pull_request',
      id: '5',
    }),
  ).toBeUndefined();
});
