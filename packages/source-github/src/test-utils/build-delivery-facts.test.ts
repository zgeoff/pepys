import { expect, onTestFinished, test } from 'bun:test';
import { createTestStore } from '@pepys/testing';
import { githubPlugin } from '../github-plugin.ts';
import { githubSource } from '../github-source.ts';
import { buildDeliveryFacts } from './build-delivery-facts.ts';

async function setupTest() {
  const store = await createTestStore({ plugins: [githubPlugin] });

  onTestFinished(() => store[Symbol.asyncDispose]());

  return {
    store,
    readDeliveryTables: async () => ({
      pullRequests: await store.readRows('github_pull_request'),
      bumps: await store.readRows('github_release_bump'),
      releases: await store.readRows('github_release'),
      commits: await store.readRows('github_commit'),
      deploys: await store.readRows('github_deploy'),
    }),
  };
}

test('it gives the GitHub consumers the rows of the delivery scenario', async () => {
  const ctx = await setupTest();

  await ctx.store.apply(githubSource, buildDeliveryFacts());

  const tables = await ctx.readDeliveryTables();

  expect(tables).toStrictEqual({
    pullRequests: [
      {
        id: 'github:pull_request:10',
        number: 10,
        repository_id: 'github:repo:1',
        title: 'A change',
        state: 'closed',
        is_draft: false,
        is_merged: true,
        author_id: 'github:user:9001',
        url: 'https://github.example/pull/10',
        merge_commit_sha: 'm1',
        created_at: '2026-10-01T08:00:00Z',
        updated_at: '2026-10-01T10:00:00Z',
        closed_at: '2026-10-01T10:00:00Z',
        merged_at: '2026-10-01T10:00:00Z',
        payload: expect.any(Object),
      },
      {
        id: 'github:pull_request:11',
        number: 11,
        repository_id: 'github:repo:1',
        title: 'A change',
        state: 'open',
        is_draft: false,
        is_merged: false,
        author_id: 'github:user:9001',
        url: 'https://github.example/pull/11',
        merge_commit_sha: null,
        created_at: '2026-10-01T08:00:00Z',
        updated_at: '2026-10-01T08:00:00Z',
        closed_at: null,
        merged_at: null,
        payload: expect.any(Object),
      },
      {
        id: 'github:pull_request:20',
        number: 20,
        repository_id: 'github:repo:2',
        title: 'A change',
        state: 'closed',
        is_draft: false,
        is_merged: true,
        author_id: 'github:user:9001',
        url: 'https://github.example/pull/20',
        merge_commit_sha: 'b1',
        created_at: '2026-10-01T08:00:00Z',
        updated_at: '2026-10-01T12:00:00Z',
        closed_at: '2026-10-01T12:00:00Z',
        merged_at: '2026-10-01T12:00:00Z',
        payload: expect.any(Object),
      },
    ],
    bumps: [
      {
        pull_request_id: 'github:pull_request:20',
        release_repository: 'acme/kit',
        release_tag: 'v1.2.0',
      },
    ],
    releases: [
      {
        id: 'github:release:1',
        repository_id: 'github:repo:1',
        repository_full_name: 'acme/kit',
        tag_name: 'v1.1.0',
        target_commitish: 'r0',
        name: 'v1.1.0',
        url: 'https://github.example/acme/kit/releases/tag/v1.1.0',
        is_draft: false,
        is_prerelease: false,
        created_at: '2026-10-01T08:00:00Z',
        published_at: '2026-10-01T09:05:00Z',
        updated_at: '2026-10-01T09:05:00Z',
        deleted_at: null,
      },
      {
        id: 'github:release:2',
        repository_id: 'github:repo:1',
        repository_full_name: 'acme/kit',
        tag_name: 'v1.2.0',
        target_commitish: 'r1',
        name: 'v1.2.0',
        url: 'https://github.example/acme/kit/releases/tag/v1.2.0',
        is_draft: false,
        is_prerelease: false,
        created_at: '2026-10-01T08:00:00Z',
        published_at: '2026-10-01T11:05:00Z',
        updated_at: '2026-10-01T11:05:00Z',
        deleted_at: null,
      },
      {
        id: 'github:release:3',
        repository_id: 'github:repo:1',
        repository_full_name: 'acme/kit',
        tag_name: 'v1.3.0',
        target_commitish: 'r2',
        name: 'v1.3.0',
        url: 'https://github.example/acme/kit/releases/tag/v1.3.0',
        is_draft: true,
        is_prerelease: false,
        created_at: '2026-10-01T08:00:00Z',
        published_at: null,
        updated_at: '2026-10-01T08:00:00Z',
        deleted_at: null,
      },
      {
        id: 'github:release:4',
        repository_id: 'github:repo:1',
        repository_full_name: 'acme/kit',
        tag_name: 'v1.3.1',
        target_commitish: 'r2',
        name: 'v1.3.1',
        url: 'https://github.example/acme/kit/releases/tag/v1.3.1',
        is_draft: false,
        is_prerelease: false,
        created_at: '2026-10-01T08:00:00Z',
        published_at: '2026-10-01T10:30:00Z',
        updated_at: '2026-10-01T10:40:00Z',
        deleted_at: '2026-10-01T10:40:00Z',
      },
      {
        id: 'github:release:5',
        repository_id: 'github:repo:1',
        repository_full_name: 'acme/kit',
        tag_name: 'v1.4.0',
        target_commitish: 'r3',
        name: 'v1.4.0',
        url: 'https://github.example/acme/kit/releases/tag/v1.4.0',
        is_draft: false,
        is_prerelease: false,
        created_at: '2026-10-01T08:00:00Z',
        published_at: '2026-10-01T13:05:00Z',
        updated_at: '2026-10-01T13:05:00Z',
        deleted_at: null,
      },
    ],
    commits: [
      { repository_id: 'github:repo:1', sha: 'm1', committed_at: '2026-10-01T12:00:00+02:00' },
      { repository_id: 'github:repo:1', sha: 'r0', committed_at: '2026-10-01T11:00:00+02:00' },
      { repository_id: 'github:repo:1', sha: 'r1', committed_at: '2026-10-01T11:00:00Z' },
      { repository_id: 'github:repo:1', sha: 'r2', committed_at: '2026-10-01T10:20:00Z' },
      { repository_id: 'github:repo:1', sha: 'r3', committed_at: '2026-10-01T13:00:00Z' },
      { repository_id: 'github:repo:2', sha: 'b1', committed_at: '2026-10-01T12:00:00Z' },
      { repository_id: 'github:repo:2', sha: 'd0', committed_at: '2026-10-01T11:30:00Z' },
      { repository_id: 'github:repo:2', sha: 'd1', committed_at: '2026-10-01T12:30:00Z' },
    ],
    deploys: [
      {
        id: 'github:deploy:2:production:deployment_status:d1',
        repository_id: 'github:repo:2',
        environment: 'production',
        target: null,
        sha: 'd1',
        signal: 'deployment_status',
        deployed_at: '2026-10-01T12:20:00Z',
      },
      {
        id: 'github:deploy:2:production:tag:d0',
        repository_id: 'github:repo:2',
        environment: 'production',
        target: null,
        sha: 'd0',
        signal: 'tag',
        deployed_at: '2026-10-01T11:40:00.000Z',
      },
      {
        id: 'github:deploy:2:production:tag:d1',
        repository_id: 'github:repo:2',
        environment: 'production',
        target: null,
        sha: 'd1',
        signal: 'tag',
        deployed_at: '2026-10-01T12:40:00.000Z',
      },
      {
        id: 'github:deploy:2:production:tag:d1:api',
        repository_id: 'github:repo:2',
        environment: 'production',
        target: 'api',
        sha: 'd1',
        signal: 'tag',
        deployed_at: '2026-10-01T12:35:00.000Z',
      },
      {
        id: 'github:deploy:2:staging:deployment_status:d1',
        repository_id: 'github:repo:2',
        environment: 'staging',
        target: null,
        sha: 'd1',
        signal: 'deployment_status',
        deployed_at: '2026-10-01T12:50:00Z',
      },
    ],
  });
});
