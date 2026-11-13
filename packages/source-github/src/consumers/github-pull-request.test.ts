import { expect, test } from 'bun:test';
import { createStubHostRead } from '@pepys/kit/test-utils/create-stub-host-read';
import { applyFact } from './github-pull-request.ts';

function setupTest() {
  const rows = new Map<string, string>();
  const aliasRows = new Map<string, string>();

  createStubHostRead('GithubPullRequest', rows);
  createStubHostRead('GithubPullRequestAlias', aliasRows);

  return { rows, aliasRows };
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
    entity: 'github:pull_request:1874433021',
    actor: 'github:user:4401',
    at: '2026-10-01T09:00:00Z',
    payload: { action: 'opened', pull_request: pullRequest, sender: { id: 4401 } },
  };

  const factJSON = JSON.stringify(fact);

  expect(JSON.parse(applyFact(factJSON))).toStrictEqual([
    {
      upsert: {
        github_pull_request: {
          id: 'github:pull_request:1874433021',
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
    {
      upsert: {
        github_pull_request_alias: {
          alias: 'https://github.example/acme/harbour/pull/12',
          entity_id: 'github:pull_request:1874433021',
          updated_at: '2026-10-01T09:00:00Z',
        },
      },
    },
    {
      upsert: {
        github_pull_request_alias: {
          alias: 'acme/harbour#12',
          entity_id: 'github:pull_request:1874433021',
          updated_at: '2026-10-01T09:00:00Z',
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
    entity: 'github:pull_request:77',
    at: '2026-10-02T10:30:00Z',
    payload: { action: 'closed', pull_request: pullRequest },
  };

  const factJSON = JSON.stringify(fact);

  expect(JSON.parse(applyFact(factJSON))).toStrictEqual([
    {
      upsert: {
        github_pull_request: {
          id: 'github:pull_request:77',
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
    {
      upsert: {
        github_pull_request_alias: {
          alias: 'https://github.example/acme/harbour/pull/3',
          entity_id: 'github:pull_request:77',
          updated_at: '2026-10-02T10:30:00Z',
        },
      },
    },
    {
      upsert: {
        github_pull_request_alias: {
          alias: 'acme/harbour#3',
          entity_id: 'github:pull_request:77',
          updated_at: '2026-10-02T10:30:00Z',
        },
      },
    },
  ]);
});

test('it replaces the stored row with a fact that has a newer update time', () => {
  const ctx = setupTest();

  ctx.rows.set(
    'github:pull_request:77',
    JSON.stringify({
      id: 'github:pull_request:77',
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
          id: 'github:pull_request:77',
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
    {
      upsert: {
        github_pull_request_alias: {
          alias: 'https://github.example/acme/harbour/pull/3',
          entity_id: 'github:pull_request:77',
          updated_at: '2026-10-01T09:05:00Z',
        },
      },
    },
    {
      upsert: {
        github_pull_request_alias: {
          alias: 'acme/harbour#3',
          entity_id: 'github:pull_request:77',
          updated_at: '2026-10-01T09:05:00Z',
        },
      },
    },
  ]);
});

test('it returns no operations for a fact older than the stored row', () => {
  const ctx = setupTest();

  ctx.rows.set(
    'github:pull_request:77',
    JSON.stringify({
      id: 'github:pull_request:77',
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

test('it returns no operations for a repeat of the stored fact', () => {
  const ctx = setupTest();

  const pullRequest = {
    id: 77,
    number: 3,
    title: 'Title',
    state: 'open',
    html_url: 'https://github.example/acme/harbour/pull/3',
    base: { repo: { id: 902 } },
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-01T09:05:00Z',
  };

  ctx.rows.set(
    'github:pull_request:77',
    JSON.stringify({
      id: 'github:pull_request:77',
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
      payload: pullRequest,
    }),
  );

  const factJSON = JSON.stringify({ payload: { pull_request: pullRequest } });

  expect(JSON.parse(applyFact(factJSON))).toStrictEqual([]);
});

test('it upserts a different fact that has the stored update time', () => {
  const ctx = setupTest();

  ctx.rows.set(
    'github:pull_request:77',
    JSON.stringify({
      id: 'github:pull_request:77',
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

  const pullRequest = {
    id: 77,
    number: 3,
    title: 'Title',
    state: 'closed',
    html_url: 'https://github.example/acme/harbour/pull/3',
    base: { repo: { id: 902 } },
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-01T09:05:00Z',
    closed_at: '2026-10-01T09:05:00Z',
  };

  const factJSON = JSON.stringify({ payload: { pull_request: pullRequest } });

  expect(JSON.parse(applyFact(factJSON))).toStrictEqual([
    {
      upsert: {
        github_pull_request: {
          id: 'github:pull_request:77',
          number: 3,
          repository_id: 'github:repo:902',
          title: 'Title',
          state: 'closed',
          is_draft: false,
          is_merged: false,
          author_id: null,
          url: 'https://github.example/acme/harbour/pull/3',
          merge_commit_sha: null,
          created_at: '2026-10-01T09:00:00Z',
          updated_at: '2026-10-01T09:05:00Z',
          closed_at: '2026-10-01T09:05:00Z',
          merged_at: null,
          payload: pullRequest,
        },
      },
    },
    {
      upsert: {
        github_pull_request_alias: {
          alias: 'https://github.example/acme/harbour/pull/3',
          entity_id: 'github:pull_request:77',
          updated_at: '2026-10-01T09:05:00Z',
        },
      },
    },
    {
      upsert: {
        github_pull_request_alias: {
          alias: 'acme/harbour#3',
          entity_id: 'github:pull_request:77',
          updated_at: '2026-10-01T09:05:00Z',
        },
      },
    },
  ]);
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

test('it upserts one bump row per release URL in the body of a bot pull request', () => {
  setupTest();

  const pullRequest = {
    id: 88,
    number: 14,
    title: 'Bump the kit',
    state: 'open',
    html_url: 'https://github.example/acme/harbour/pull/14',
    user: { id: 9001, type: 'Bot' },
    base: { repo: { id: 902 } },
    body: [
      'Bumps [kit](https://github.com/acme/kit) from 1.1.0 to 1.2.0.',
      '- [Release notes](https://github.com/acme/kit/releases/tag/kit%2Fv1.2.0)',
      '- See https://github.com/acme/tide/releases/tag/v3.0.0 and',
      '  [again](https://github.com/acme/kit/releases/tag/kit%2Fv1.2.0).',
    ].join('\n'),
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-01T09:00:00Z',
  };

  const factJSON = JSON.stringify({ payload: { pull_request: pullRequest } });

  expect(JSON.parse(applyFact(factJSON))).toStrictEqual([
    {
      upsert: {
        github_pull_request: {
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
          updated_at: '2026-10-01T09:00:00Z',
          closed_at: null,
          merged_at: null,
          payload: pullRequest,
        },
      },
    },
    {
      upsert: {
        github_pull_request_alias: {
          alias: 'https://github.example/acme/harbour/pull/14',
          entity_id: 'github:pull_request:88',
          updated_at: '2026-10-01T09:00:00Z',
        },
      },
    },
    {
      upsert: {
        github_pull_request_alias: {
          alias: 'acme/harbour#14',
          entity_id: 'github:pull_request:88',
          updated_at: '2026-10-01T09:00:00Z',
        },
      },
    },
    {
      upsert: {
        github_release_bump: {
          pull_request_id: 'github:pull_request:88',
          release_repository: 'acme/kit',
          release_tag: 'kit/v1.2.0',
        },
      },
    },
    {
      upsert: {
        github_release_bump: {
          pull_request_id: 'github:pull_request:88',
          release_repository: 'acme/tide',
          release_tag: 'v3.0.0',
        },
      },
    },
  ]);
});

test.each([
  { urlTag: 'kit/v1.2.0', tag: 'kit/v1.2.0' },
  { urlTag: '@acme/kit@1.2.0', tag: '@acme/kit@1.2.0' },
  { urlTag: '%40acme%2Fkit%401.2.0', tag: '@acme/kit@1.2.0' },
])('it upserts a bump row for the release tag $urlTag', (row) => {
  setupTest();

  const pullRequest = {
    id: 90,
    number: 16,
    title: 'Bump the kit',
    state: 'open',
    html_url: 'https://github.example/acme/harbour/pull/16',
    user: { id: 9001, type: 'Bot' },
    base: { repo: { id: 902 } },
    body: `- [Release notes](https://github.com/acme/kit/releases/tag/${row.urlTag})`,
    created_at: '2026-10-02T09:00:00Z',
    updated_at: '2026-10-02T09:00:00Z',
  };

  const factJSON = JSON.stringify({ payload: { pull_request: pullRequest } });

  expect(JSON.parse(applyFact(factJSON))).toStrictEqual([
    {
      upsert: {
        github_pull_request: {
          id: 'github:pull_request:90',
          number: 16,
          repository_id: 'github:repo:902',
          title: 'Bump the kit',
          state: 'open',
          is_draft: false,
          is_merged: false,
          author_id: 'github:user:9001',
          url: 'https://github.example/acme/harbour/pull/16',
          merge_commit_sha: null,
          created_at: '2026-10-02T09:00:00Z',
          updated_at: '2026-10-02T09:00:00Z',
          closed_at: null,
          merged_at: null,
          payload: pullRequest,
        },
      },
    },
    {
      upsert: {
        github_pull_request_alias: {
          alias: 'https://github.example/acme/harbour/pull/16',
          entity_id: 'github:pull_request:90',
          updated_at: '2026-10-02T09:00:00Z',
        },
      },
    },
    {
      upsert: {
        github_pull_request_alias: {
          alias: 'acme/harbour#16',
          entity_id: 'github:pull_request:90',
          updated_at: '2026-10-02T09:00:00Z',
        },
      },
    },
    {
      upsert: {
        github_release_bump: {
          pull_request_id: 'github:pull_request:90',
          release_repository: 'acme/kit',
          release_tag: row.tag,
        },
      },
    },
  ]);
});

test('it writes no bump row for a release URL in the body of a person', () => {
  setupTest();

  const pullRequest = {
    id: 89,
    number: 15,
    title: 'Note the release',
    state: 'open',
    html_url: 'https://github.example/acme/harbour/pull/15',
    user: { id: 4401, type: 'User' },
    base: { repo: { id: 902 } },
    body: 'See https://github.com/acme/kit/releases/tag/v1.2.0',
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-01T09:00:00Z',
  };

  const factJSON = JSON.stringify({ payload: { pull_request: pullRequest } });
  const operations: unknown = JSON.parse(applyFact(factJSON));

  expect(operations).toStrictEqual([
    {
      upsert: {
        github_pull_request: {
          id: 'github:pull_request:89',
          number: 15,
          repository_id: 'github:repo:902',
          title: 'Note the release',
          state: 'open',
          is_draft: false,
          is_merged: false,
          author_id: 'github:user:4401',
          url: 'https://github.example/acme/harbour/pull/15',
          merge_commit_sha: null,
          created_at: '2026-10-01T09:00:00Z',
          updated_at: '2026-10-01T09:00:00Z',
          closed_at: null,
          merged_at: null,
          payload: pullRequest,
        },
      },
    },
    {
      upsert: {
        github_pull_request_alias: {
          alias: 'https://github.example/acme/harbour/pull/15',
          entity_id: 'github:pull_request:89',
          updated_at: '2026-10-01T09:00:00Z',
        },
      },
    },
    {
      upsert: {
        github_pull_request_alias: {
          alias: 'acme/harbour#15',
          entity_id: 'github:pull_request:89',
          updated_at: '2026-10-01T09:00:00Z',
        },
      },
    },
  ]);
});

test.each([{ urlTag: 'v1.2.0/' }, { urlTag: 'kit//v1.2.0' }])(
  'it writes no bump row for the release tag $urlTag, which has an empty part',
  (row) => {
    setupTest();

    const pullRequest = {
      id: 91,
      number: 17,
      title: 'Bump the kit',
      state: 'open',
      html_url: 'https://github.example/acme/harbour/pull/17',
      user: { id: 9001, type: 'Bot' },
      base: { repo: { id: 902 } },
      body: `- [Release notes](https://github.com/acme/kit/releases/tag/${row.urlTag})`,
      created_at: '2026-10-02T09:00:00Z',
      updated_at: '2026-10-02T09:00:00Z',
    };

    const factJSON = JSON.stringify({ payload: { pull_request: pullRequest } });
    const operations: unknown = JSON.parse(applyFact(factJSON));

    expect(operations).toStrictEqual([
      {
        upsert: {
          github_pull_request: {
            id: 'github:pull_request:91',
            number: 17,
            repository_id: 'github:repo:902',
            title: 'Bump the kit',
            state: 'open',
            is_draft: false,
            is_merged: false,
            author_id: 'github:user:9001',
            url: 'https://github.example/acme/harbour/pull/17',
            merge_commit_sha: null,
            created_at: '2026-10-02T09:00:00Z',
            updated_at: '2026-10-02T09:00:00Z',
            closed_at: null,
            merged_at: null,
            payload: pullRequest,
          },
        },
      },
      {
        upsert: {
          github_pull_request_alias: {
            alias: 'https://github.example/acme/harbour/pull/17',
            entity_id: 'github:pull_request:91',
            updated_at: '2026-10-02T09:00:00Z',
          },
        },
      },
      {
        upsert: {
          github_pull_request_alias: {
            alias: 'acme/harbour#17',
            entity_id: 'github:pull_request:91',
            updated_at: '2026-10-02T09:00:00Z',
          },
        },
      },
    ]);
  },
);

test('it replaces the bump rows of the stored body with those of a newer body', () => {
  const ctx = setupTest();

  const storedPullRequest = {
    id: 88,
    user: { id: 9001, type: 'Bot' },
    body: 'https://github.com/acme/kit/releases/tag/v1.2.0 https://github.com/acme/tide/releases/tag/v3.0.0',
  };

  ctx.rows.set(
    'github:pull_request:88',
    JSON.stringify({
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
      updated_at: '2026-10-01T09:00:00Z',
      closed_at: null,
      merged_at: null,
      payload: storedPullRequest,
    }),
  );

  const pullRequest = {
    id: 88,
    number: 14,
    title: 'Bump the kit',
    state: 'open',
    html_url: 'https://github.example/acme/harbour/pull/14',
    user: { id: 9001, type: 'Bot' },
    base: { repo: { id: 902 } },
    body: 'https://github.com/acme/tide/releases/tag/v3.0.0 https://github.com/acme/kit/releases/tag/v1.3.0',
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
  };

  const factJSON = JSON.stringify({ payload: { pull_request: pullRequest } });

  expect(JSON.parse(applyFact(factJSON))).toStrictEqual([
    {
      upsert: {
        github_pull_request: {
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
          updated_at: '2026-10-01T10:00:00Z',
          closed_at: null,
          merged_at: null,
          payload: pullRequest,
        },
      },
    },
    {
      upsert: {
        github_pull_request_alias: {
          alias: 'https://github.example/acme/harbour/pull/14',
          entity_id: 'github:pull_request:88',
          updated_at: '2026-10-01T10:00:00Z',
        },
      },
    },
    {
      upsert: {
        github_pull_request_alias: {
          alias: 'acme/harbour#14',
          entity_id: 'github:pull_request:88',
          updated_at: '2026-10-01T10:00:00Z',
        },
      },
    },
    {
      delete: {
        github_release_bump: {
          pull_request_id: 'github:pull_request:88',
          release_repository: 'acme/kit',
          release_tag: 'v1.2.0',
        },
      },
    },
    {
      upsert: {
        github_release_bump: {
          pull_request_id: 'github:pull_request:88',
          release_repository: 'acme/kit',
          release_tag: 'v1.3.0',
        },
      },
    },
  ]);
});

test('it writes the aliases of a pull request in lowercase', () => {
  setupTest();

  const pullRequest = {
    id: 93,
    number: 21,
    title: 'Chart the reef',
    state: 'open',
    html_url: 'https://github.example/Acme/Harbour-Charts/pull/21',
    base: { repo: { id: 903 } },
    created_at: '2026-10-03T09:00:00Z',
    updated_at: '2026-10-03T09:00:00Z',
  };

  const factJSON = JSON.stringify({ payload: { pull_request: pullRequest } });

  expect(JSON.parse(applyFact(factJSON))).toStrictEqual([
    {
      upsert: {
        github_pull_request: {
          id: 'github:pull_request:93',
          number: 21,
          repository_id: 'github:repo:903',
          title: 'Chart the reef',
          state: 'open',
          is_draft: false,
          is_merged: false,
          author_id: null,
          url: 'https://github.example/Acme/Harbour-Charts/pull/21',
          merge_commit_sha: null,
          created_at: '2026-10-03T09:00:00Z',
          updated_at: '2026-10-03T09:00:00Z',
          closed_at: null,
          merged_at: null,
          payload: pullRequest,
        },
      },
    },
    {
      upsert: {
        github_pull_request_alias: {
          alias: 'https://github.example/acme/harbour-charts/pull/21',
          entity_id: 'github:pull_request:93',
          updated_at: '2026-10-03T09:00:00Z',
        },
      },
    },
    {
      upsert: {
        github_pull_request_alias: {
          alias: 'acme/harbour-charts#21',
          entity_id: 'github:pull_request:93',
          updated_at: '2026-10-03T09:00:00Z',
        },
      },
    },
  ]);
});

test('it writes only the URL alias for a URL with no pull request path', () => {
  setupTest();

  const pullRequest = {
    id: 94,
    number: 22,
    title: 'Chart the shoal',
    state: 'open',
    html_url: 'https://github.example/enterprise/acme/harbour/pull/22',
    base: { repo: { id: 903 } },
    created_at: '2026-10-03T09:00:00Z',
    updated_at: '2026-10-03T09:00:00Z',
  };

  const factJSON = JSON.stringify({ payload: { pull_request: pullRequest } });

  expect(JSON.parse(applyFact(factJSON))).toStrictEqual([
    {
      upsert: {
        github_pull_request: {
          id: 'github:pull_request:94',
          number: 22,
          repository_id: 'github:repo:903',
          title: 'Chart the shoal',
          state: 'open',
          is_draft: false,
          is_merged: false,
          author_id: null,
          url: 'https://github.example/enterprise/acme/harbour/pull/22',
          merge_commit_sha: null,
          created_at: '2026-10-03T09:00:00Z',
          updated_at: '2026-10-03T09:00:00Z',
          closed_at: null,
          merged_at: null,
          payload: pullRequest,
        },
      },
    },
    {
      upsert: {
        github_pull_request_alias: {
          alias: 'https://github.example/enterprise/acme/harbour/pull/22',
          entity_id: 'github:pull_request:94',
          updated_at: '2026-10-03T09:00:00Z',
        },
      },
    },
  ]);
});

test('it adds the aliases of a renamed repository and deletes none', () => {
  const ctx = setupTest();

  ctx.rows.set(
    'github:pull_request:77',
    JSON.stringify({
      id: 'github:pull_request:77',
      number: 3,
      repository_id: 'github:repo:902',
      title: 'Fix the tide table',
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
    title: 'Fix the tide table',
    state: 'open',
    html_url: 'https://github.example/acme/quay/pull/3',
    base: { repo: { id: 902 } },
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-04T09:00:00Z',
  };

  const factJSON = JSON.stringify({ payload: { pull_request: pullRequest } });

  expect(JSON.parse(applyFact(factJSON))).toStrictEqual([
    {
      upsert: {
        github_pull_request: {
          id: 'github:pull_request:77',
          number: 3,
          repository_id: 'github:repo:902',
          title: 'Fix the tide table',
          state: 'open',
          is_draft: false,
          is_merged: false,
          author_id: null,
          url: 'https://github.example/acme/quay/pull/3',
          merge_commit_sha: null,
          created_at: '2026-10-01T09:00:00Z',
          updated_at: '2026-10-04T09:00:00Z',
          closed_at: null,
          merged_at: null,
          payload: pullRequest,
        },
      },
    },
    {
      upsert: {
        github_pull_request_alias: {
          alias: 'https://github.example/acme/quay/pull/3',
          entity_id: 'github:pull_request:77',
          updated_at: '2026-10-04T09:00:00Z',
        },
      },
    },
    {
      upsert: {
        github_pull_request_alias: {
          alias: 'acme/quay#3',
          entity_id: 'github:pull_request:77',
          updated_at: '2026-10-04T09:00:00Z',
        },
      },
    },
  ]);
});

test.each([
  ['github:pull_request:202', '2026-10-01T09:00:00Z'],
  ['github:pull_request:202', '2026-10-02T09:00:00Z'],
  ['github:pull_request:101', '2026-10-01T09:00:00Z'],
])(
  'it writes an alias that %p holds from %p to a fact of that time or later',
  (holderID, holderUpdatedAt) => {
    const ctx = setupTest();

    ctx.aliasRows.set(
      'acme/harbour#3',
      JSON.stringify({
        alias: 'acme/harbour#3',
        entity_id: holderID,
        updated_at: holderUpdatedAt,
      }),
    );

    const pullRequest = {
      id: 101,
      number: 3,
      title: 'Fix the tide table',
      state: 'open',
      html_url: 'https://github.example/acme/harbour/pull/3',
      base: { repo: { id: 902 } },
      created_at: '2026-10-01T09:00:00Z',
      updated_at: '2026-10-02T09:00:00Z',
    };

    const factJSON = JSON.stringify({ payload: { pull_request: pullRequest } });

    expect(JSON.parse(applyFact(factJSON))).toStrictEqual([
      {
        upsert: {
          github_pull_request: {
            id: 'github:pull_request:101',
            number: 3,
            repository_id: 'github:repo:902',
            title: 'Fix the tide table',
            state: 'open',
            is_draft: false,
            is_merged: false,
            author_id: null,
            url: 'https://github.example/acme/harbour/pull/3',
            merge_commit_sha: null,
            created_at: '2026-10-01T09:00:00Z',
            updated_at: '2026-10-02T09:00:00Z',
            closed_at: null,
            merged_at: null,
            payload: pullRequest,
          },
        },
      },
      {
        upsert: {
          github_pull_request_alias: {
            alias: 'https://github.example/acme/harbour/pull/3',
            entity_id: 'github:pull_request:101',
            updated_at: '2026-10-02T09:00:00Z',
          },
        },
      },
      {
        upsert: {
          github_pull_request_alias: {
            alias: 'acme/harbour#3',
            entity_id: 'github:pull_request:101',
            updated_at: '2026-10-02T09:00:00Z',
          },
        },
      },
    ]);
  },
);

test('it writes no alias that the pull request already holds from the fact time', () => {
  const ctx = setupTest();

  ctx.aliasRows.set(
    'acme/harbour#3',
    JSON.stringify({
      alias: 'acme/harbour#3',
      entity_id: 'github:pull_request:101',
      updated_at: '2026-10-02T09:00:00Z',
    }),
  );

  const pullRequest = {
    id: 101,
    number: 3,
    title: 'Fix the tide table',
    state: 'open',
    html_url: 'https://github.example/acme/harbour/pull/3',
    base: { repo: { id: 902 } },
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-02T09:00:00Z',
  };

  const factJSON = JSON.stringify({ payload: { pull_request: pullRequest } });

  expect(JSON.parse(applyFact(factJSON))).toStrictEqual([
    {
      upsert: {
        github_pull_request: {
          id: 'github:pull_request:101',
          number: 3,
          repository_id: 'github:repo:902',
          title: 'Fix the tide table',
          state: 'open',
          is_draft: false,
          is_merged: false,
          author_id: null,
          url: 'https://github.example/acme/harbour/pull/3',
          merge_commit_sha: null,
          created_at: '2026-10-01T09:00:00Z',
          updated_at: '2026-10-02T09:00:00Z',
          closed_at: null,
          merged_at: null,
          payload: pullRequest,
        },
      },
    },
    {
      upsert: {
        github_pull_request_alias: {
          alias: 'https://github.example/acme/harbour/pull/3',
          entity_id: 'github:pull_request:101',
          updated_at: '2026-10-02T09:00:00Z',
        },
      },
    },
  ]);
});

test('it leaves an alias with a pull request whose newer fact names it', () => {
  const ctx = setupTest();

  ctx.aliasRows.set(
    'https://github.example/acme/harbour/pull/3',
    JSON.stringify({
      alias: 'https://github.example/acme/harbour/pull/3',
      entity_id: 'github:pull_request:202',
      updated_at: '2026-10-05T09:00:00Z',
    }),
  );

  ctx.aliasRows.set(
    'acme/harbour#3',
    JSON.stringify({
      alias: 'acme/harbour#3',
      entity_id: 'github:pull_request:202',
      updated_at: '2026-10-05T09:00:00Z',
    }),
  );

  const pullRequest = {
    id: 101,
    number: 3,
    title: 'Fix the tide table',
    state: 'closed',
    html_url: 'https://github.example/acme/harbour/pull/3',
    base: { repo: { id: 902 } },
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-02T09:00:00Z',
  };

  const factJSON = JSON.stringify({ payload: { pull_request: pullRequest } });

  expect(JSON.parse(applyFact(factJSON))).toStrictEqual([
    {
      upsert: {
        github_pull_request: {
          id: 'github:pull_request:101',
          number: 3,
          repository_id: 'github:repo:902',
          title: 'Fix the tide table',
          state: 'closed',
          is_draft: false,
          is_merged: false,
          author_id: null,
          url: 'https://github.example/acme/harbour/pull/3',
          merge_commit_sha: null,
          created_at: '2026-10-01T09:00:00Z',
          updated_at: '2026-10-02T09:00:00Z',
          closed_at: null,
          merged_at: null,
          payload: pullRequest,
        },
      },
    },
  ]);
});

test('it moves an alias to a newer fact when the holder has since moved to another repository', () => {
  const ctx = setupTest();

  ctx.rows.set(
    'github:pull_request:101',
    JSON.stringify({
      id: 'github:pull_request:101',
      number: 3,
      repository_id: 'github:repo:902',
      title: 'Chart the harbour mouth',
      state: 'open',
      is_draft: false,
      is_merged: false,
      author_id: null,
      url: 'https://github.example/acme/estuary/pull/3',
      merge_commit_sha: null,
      created_at: '2026-10-01T09:00:00Z',
      updated_at: '2026-10-05T09:00:00Z',
      closed_at: null,
      merged_at: null,
      payload: {},
    }),
  );

  ctx.aliasRows.set(
    'https://github.example/acme/harbour/pull/3',
    JSON.stringify({
      alias: 'https://github.example/acme/harbour/pull/3',
      entity_id: 'github:pull_request:101',
      updated_at: '2026-10-01T09:00:00Z',
    }),
  );

  ctx.aliasRows.set(
    'acme/harbour#3',
    JSON.stringify({
      alias: 'acme/harbour#3',
      entity_id: 'github:pull_request:101',
      updated_at: '2026-10-01T09:00:00Z',
    }),
  );

  const pullRequest = {
    id: 202,
    number: 3,
    title: 'Open the new harbour',
    state: 'open',
    html_url: 'https://github.example/acme/harbour/pull/3',
    base: { repo: { id: 977 } },
    created_at: '2026-10-03T09:00:00Z',
    updated_at: '2026-10-03T09:00:00Z',
  };

  const factJSON = JSON.stringify({ payload: { pull_request: pullRequest } });

  expect(JSON.parse(applyFact(factJSON))).toStrictEqual([
    {
      upsert: {
        github_pull_request: {
          id: 'github:pull_request:202',
          number: 3,
          repository_id: 'github:repo:977',
          title: 'Open the new harbour',
          state: 'open',
          is_draft: false,
          is_merged: false,
          author_id: null,
          url: 'https://github.example/acme/harbour/pull/3',
          merge_commit_sha: null,
          created_at: '2026-10-03T09:00:00Z',
          updated_at: '2026-10-03T09:00:00Z',
          closed_at: null,
          merged_at: null,
          payload: pullRequest,
        },
      },
    },
    {
      upsert: {
        github_pull_request_alias: {
          alias: 'https://github.example/acme/harbour/pull/3',
          entity_id: 'github:pull_request:202',
          updated_at: '2026-10-03T09:00:00Z',
        },
      },
    },
    {
      upsert: {
        github_pull_request_alias: {
          alias: 'acme/harbour#3',
          entity_id: 'github:pull_request:202',
          updated_at: '2026-10-03T09:00:00Z',
        },
      },
    },
  ]);
});
