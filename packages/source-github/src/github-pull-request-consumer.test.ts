import { expect, test } from 'bun:test';
import { checkConsumers } from '@pepys/schema';
import { githubPullRequestConsumer } from './github-pull-request-consumer.ts';

test('it declares a consumer that passes the consumer checks', () => {
  expect(checkConsumers([githubPullRequestConsumer])).toStrictEqual({ ok: true });
});

test('it owns the pull request table and tails the pull request stream', () => {
  expect(Object.keys(githubPullRequestConsumer.tables)).toStrictEqual(['github_pull_request']);
  expect(githubPullRequestConsumer.streams).toStrictEqual(['facts.github.pull_request']);
});

test('it declares the pull request columns', () => {
  expect(githubPullRequestConsumer.tables.github_pull_request.columns).toStrictEqual({
    id: { kind: 'entityID' },
    number: { kind: 'integer' },
    repository_id: { kind: 'entityID' },
    title: { kind: 'text' },
    state: { kind: 'text' },
    is_draft: { kind: 'boolean' },
    is_merged: { kind: 'boolean' },
    author_id: { kind: 'entityID', nullable: true },
    url: { kind: 'text' },
    merge_commit_sha: { kind: 'text', nullable: true },
    created_at: { kind: 'timestamp' },
    updated_at: { kind: 'timestamp' },
    closed_at: { kind: 'timestamp', nullable: true },
    merged_at: { kind: 'timestamp', nullable: true },
    payload: { kind: 'json' },
  });
});

test('it maps the entity view to the title, URL, author and update time', () => {
  expect(githubPullRequestConsumer.entityView).toStrictEqual({
    table: 'github_pull_request',
    kind: 'pr',
    id: 'id',
    title: 'title',
    url: 'url',
    actor: 'author_id',
    updatedAt: 'updated_at',
  });
});

test('it reads its own table, so a fact older than the stored row changes nothing', () => {
  expect(githubPullRequestConsumer.reads).toStrictEqual(['github_pull_request']);
});
