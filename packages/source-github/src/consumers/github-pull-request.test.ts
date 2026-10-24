import { expect, onTestFinished, test } from 'bun:test';
import { applyFact } from './github-pull-request.ts';

function setupTest() {
  const rows = new Map<string, string>();

  Object.assign(globalThis, {
    readGithubPullRequestLength: (key: string): number => {
      const row = rows.get(key);

      return row === undefined ? -1 : new TextEncoder().encode(row).length;
    },
    readGithubPullRequestInto: (key: string, buffer: Uint8Array): void => {
      buffer.set(new TextEncoder().encode(rows.get(key) ?? ''));
    },
  });

  onTestFinished(() => {
    Reflect.deleteProperty(globalThis, 'readGithubPullRequestLength');
    Reflect.deleteProperty(globalThis, 'readGithubPullRequestInto');
  });

  return { rows };
}

test('it upserts the row of an opened pull request', () => {
  setupTest();

  const pullRequest = {
    id: 1_874_433_021,
    number: 12,
    title: 'Add the harbour map',
    state: 'open',
    draft: true,
    merged: false,
    merge_commit_sha: null,
    html_url: 'https://github.example/acme/harbour/pull/12',
    user: { id: 4401 },
    base: { repo: { id: 902 } },
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-01T09:00:00Z',
    closed_at: null,
    merged_at: null,
  };

  const fact = {
    id: 'webhook:github:delivery-1',
    type: 'github.pull_request.opened',
    api: 'github/2022-11-28',
    entity: 'github:pr:1874433021',
    actor: 'github:user:4401',
    at: '2026-10-01T09:00:00Z',
    payload: { action: 'opened', pull_request: pullRequest, sender: { id: 4401 } },
  };

  const factJSON = JSON.stringify(fact);

  expect(JSON.parse(applyFact(factJSON))).toStrictEqual([
    {
      upsert: {
        github_pull_request: {
          id: 'github:pr:1874433021',
          number: 12,
          repository_id: 'github:repo:902',
          title: 'Add the harbour map',
          state: 'open',
          is_draft: true,
          is_merged: false,
          author_id: 'github:user:4401',
          url: 'https://github.example/acme/harbour/pull/12',
          merge_commit_sha: null,
          created_at: '2026-10-01T09:00:00Z',
          updated_at: '2026-10-01T09:00:00Z',
          closed_at: null,
          merged_at: null,
          payload: pullRequest,
        },
      },
    },
  ]);
});

test('it maps the merge details of a merged pull request', () => {
  setupTest();

  const pullRequest = {
    id: 77,
    number: 3,
    title: 'Fix the tide table',
    state: 'closed',
    draft: false,
    merged: true,
    merge_commit_sha: 'a1b2c3d4',
    html_url: 'https://github.example/acme/harbour/pull/3',
    user: { id: 55 },
    base: { repo: { id: 902 } },
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-02T10:30:00Z',
    closed_at: '2026-10-02T10:30:00Z',
    merged_at: '2026-10-02T10:30:00Z',
  };

  const fact = {
    id: 'webhook:github:delivery-2',
    type: 'github.pull_request.closed',
    api: 'github/2022-11-28',
    entity: 'github:pr:77',
    at: '2026-10-02T10:30:00Z',
    payload: { action: 'closed', pull_request: pullRequest },
  };

  const factJSON = JSON.stringify(fact);

  expect(JSON.parse(applyFact(factJSON))).toStrictEqual([
    {
      upsert: {
        github_pull_request: {
          id: 'github:pr:77',
          number: 3,
          repository_id: 'github:repo:902',
          title: 'Fix the tide table',
          state: 'closed',
          is_draft: false,
          is_merged: true,
          author_id: 'github:user:55',
          url: 'https://github.example/acme/harbour/pull/3',
          merge_commit_sha: 'a1b2c3d4',
          created_at: '2026-10-01T09:00:00Z',
          updated_at: '2026-10-02T10:30:00Z',
          closed_at: '2026-10-02T10:30:00Z',
          merged_at: '2026-10-02T10:30:00Z',
          payload: pullRequest,
        },
      },
    },
  ]);
});

test('it replaces the stored row with a fact that has a newer update time', () => {
  const ctx = setupTest();

  ctx.rows.set(
    'github:pr:77',
    JSON.stringify({
      id: 'github:pr:77',
      number: 3,
      repository_id: 'github:repo:902',
      title: 'Old title',
      state: 'open',
      is_draft: false,
      is_merged: false,
      author_id: null,
      url: 'https://github.example/acme/harbour/pull/3',
      merge_commit_sha: null,
      created_at: '2026-10-01T09:00:00Z',
      updated_at: '2026-10-01T09:00:00Z',
      closed_at: null,
      merged_at: null,
      payload: {},
    }),
  );

  const pullRequest = {
    id: 77,
    number: 3,
    title: 'New title',
    state: 'open',
    html_url: 'https://github.example/acme/harbour/pull/3',
    base: { repo: { id: 902 } },
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-01T09:05:00Z',
  };

  const fact = { payload: { pull_request: pullRequest } };
  const factJSON = JSON.stringify(fact);

  expect(JSON.parse(applyFact(factJSON))).toStrictEqual([
    {
      upsert: {
        github_pull_request: {
          id: 'github:pr:77',
          number: 3,
          repository_id: 'github:repo:902',
          title: 'New title',
          state: 'open',
          is_draft: false,
          is_merged: false,
          author_id: null,
          url: 'https://github.example/acme/harbour/pull/3',
          merge_commit_sha: null,
          created_at: '2026-10-01T09:00:00Z',
          updated_at: '2026-10-01T09:05:00Z',
          closed_at: null,
          merged_at: null,
          payload: pullRequest,
        },
      },
    },
  ]);
});

test('it returns no operations for a fact older than the stored row', () => {
  const ctx = setupTest();

  ctx.rows.set(
    'github:pr:77',
    JSON.stringify({
      id: 'github:pr:77',
      number: 3,
      repository_id: 'github:repo:902',
      title: 'Newest title',
      state: 'open',
      is_draft: false,
      is_merged: false,
      author_id: null,
      url: 'https://github.example/acme/harbour/pull/3',
      merge_commit_sha: null,
      created_at: '2026-10-01T09:00:00Z',
      updated_at: '2026-10-01T09:10:00Z',
      closed_at: null,
      merged_at: null,
      payload: {},
    }),
  );

  const fact = {
    payload: {
      pull_request: {
        id: 77,
        number: 3,
        title: 'Older title',
        state: 'open',
        html_url: 'https://github.example/acme/harbour/pull/3',
        base: { repo: { id: 902 } },
        created_at: '2026-10-01T09:00:00Z',
        updated_at: '2026-10-01T09:05:00Z',
      },
    },
  };

  const factJSON = JSON.stringify(fact);

  expect(JSON.parse(applyFact(factJSON))).toStrictEqual([]);
});

test('it returns no operations for a fact with the stored update time', () => {
  const ctx = setupTest();

  ctx.rows.set(
    'github:pr:77',
    JSON.stringify({
      id: 'github:pr:77',
      number: 3,
      repository_id: 'github:repo:902',
      title: 'Title',
      state: 'open',
      is_draft: false,
      is_merged: false,
      author_id: null,
      url: 'https://github.example/acme/harbour/pull/3',
      merge_commit_sha: null,
      created_at: '2026-10-01T09:00:00Z',
      updated_at: '2026-10-01T09:05:00Z',
      closed_at: null,
      merged_at: null,
      payload: {},
    }),
  );

  const fact = {
    payload: {
      pull_request: {
        id: 77,
        number: 3,
        title: 'Title',
        state: 'open',
        html_url: 'https://github.example/acme/harbour/pull/3',
        base: { repo: { id: 902 } },
        created_at: '2026-10-01T09:00:00Z',
        updated_at: '2026-10-01T09:05:00Z',
      },
    },
  };

  const factJSON = JSON.stringify(fact);

  expect(JSON.parse(applyFact(factJSON))).toStrictEqual([]);
});

test('it returns no operations for a fact without a pull request', () => {
  setupTest();

  const fact = { payload: { action: 'ping', zen: 'Keep it logically awesome.' } };
  const factJSON = JSON.stringify(fact);

  expect(JSON.parse(applyFact(factJSON))).toStrictEqual([]);
});

test('it returns no operations for a pull request without a base repository', () => {
  setupTest();

  const fact = {
    payload: {
      pull_request: {
        id: 77,
        number: 3,
        title: 'Title',
        state: 'open',
        html_url: 'https://github.example/acme/harbour/pull/3',
        created_at: '2026-10-01T09:00:00Z',
        updated_at: '2026-10-01T09:05:00Z',
      },
    },
  };

  const factJSON = JSON.stringify(fact);

  expect(JSON.parse(applyFact(factJSON))).toStrictEqual([]);
});
