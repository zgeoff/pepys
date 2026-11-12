import { expect, onTestFinished, test } from 'bun:test';
import { createTestStore } from '@pepys/testing';
import { githubPlugin } from '../github-plugin.ts';
import { githubSource } from '../github-source.ts';
import { buildPushedFact } from './build-pushed-fact.ts';

async function setupTest() {
  const store = await createTestStore({ plugins: [githubPlugin] });

  onTestFinished(() => store[Symbol.asyncDispose]());

  return { store };
}

test('it gives a push to the default branch one commit row of repository 902', async () => {
  const ctx = await setupTest();

  await ctx.store.apply(githubSource, [
    buildPushedFact('refs/heads/main', 'f00d5ea', '2026-10-02T08:00:00.000Z'),
  ]);

  const rows = {
    commits: await ctx.store.readRows('github_commit'),
    deploys: await ctx.store.readRows('github_deploy'),
  };

  expect(rows).toStrictEqual({
    commits: [
      { repository_id: 'github:repo:902', sha: 'f00d5ea', committed_at: '2026-10-01T08:00:00Z' },
    ],
    deploys: [],
  });
});

test('it gives a push of a deploy tag a tag deploy of its commit at the fact time', async () => {
  const ctx = await setupTest();

  await ctx.store.apply(githubSource, [
    buildPushedFact('refs/tags/deployed/staging', 'f00d5ea', '2026-10-02T09:15:00.000Z'),
  ]);

  const deploys = await ctx.store.readRows('github_deploy');

  expect(deploys).toStrictEqual([
    {
      id: 'github:deploy:902:staging:tag:f00d5ea',
      repository_id: 'github:repo:902',
      environment: 'staging',
      target: null,
      sha: 'f00d5ea',
      signal: 'tag',
      deployed_at: '2026-10-02T09:15:00.000Z',
    },
  ]);
});

test('it gives two pushes of one ref at two times two distinct facts', async () => {
  const ctx = await setupTest();

  await ctx.store.apply(githubSource, [
    buildPushedFact('refs/tags/deployed/staging', 'f00d5ea', '2026-10-02T09:15:00.000Z'),
    buildPushedFact('refs/tags/deployed/staging', 'f00d5ea', '2026-10-02T09:05:00.000Z'),
  ]);

  const deploys = await ctx.store.readRows('github_deploy');

  expect(deploys).toStrictEqual([
    expect.objectContaining({ deployed_at: '2026-10-02T09:05:00.000Z' }),
  ]);
});
