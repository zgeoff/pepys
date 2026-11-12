import { expect, onTestFinished, test } from 'bun:test';
import { createTestStore } from '@pepys/testing';
import { githubPlugin } from '../github-plugin.ts';
import { githubSource } from '../github-source.ts';
import { buildBotPullRequestBody } from './build-bot-pull-request-body.ts';

async function setupTest() {
  const store = await createTestStore({ plugins: [githubPlugin] });

  onTestFinished(() => store[Symbol.asyncDispose]());

  return { store };
}

test('it gives a bot pull request of repository 902 whose body bumps the kit to the tag', async () => {
  const ctx = await setupTest();

  await ctx.store.apply(githubSource, [
    {
      type: 'github.pull_request.edited',
      event: 'pull_request-edited',
      entity: 'github:pull_request:88',
      at: '2026-10-02T11:00:00Z',
      payload: buildBotPullRequestBody('2026-10-02T11:00:00Z', 'v2.0.1'),
    },
  ]);

  const rows = {
    pullRequests: await ctx.store.readRows('github_pull_request'),
    bumps: await ctx.store.readRows('github_release_bump'),
  };

  expect(rows).toStrictEqual({
    pullRequests: [
      {
        id: 'github:pull_request:88',
        number: 14,
        repository_id: 'github:repo:902',
        title: 'Bump the kit',
        state: 'open',
        is_draft: false,
        is_merged: false,
        author_id: 'github:user:9001',
        url: 'https://github.example/acme/harbour/pull/14',
        merge_commit_sha: null,
        created_at: '2026-10-01T09:00:00Z',
        updated_at: '2026-10-02T11:00:00Z',
        closed_at: null,
        merged_at: null,
        payload: expect.any(Object),
      },
    ],
    bumps: [
      {
        pull_request_id: 'github:pull_request:88',
        release_repository: 'acme/kit',
        release_tag: 'v2.0.1',
      },
    ],
  });
});
