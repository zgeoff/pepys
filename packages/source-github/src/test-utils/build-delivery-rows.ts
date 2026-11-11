import type { EntityID } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';

const kit = {
  repository: 'github:repo:1',
  repositoryName: 'acme/kit',
  createdAt: '2026-10-01T08:00:00Z',
};

const app = { repository: 'github:repo:2' };

// Kit pull request 10 merges at m1; 11 stays open. Release 2 is the first published one after m1.
// App bot pull request 20 bumps the kit to it and merges at b1, then the app deploys d1 to
// production, with and without the target `api`, and to staging by deployment status only.
export function buildDeliveryRows() {
  return {
    pullRequests: [
      buildPullRequestRow({
        id: 'github:pull_request:10',
        repository: kit.repository,
        mergeSha: 'm1',
        mergedAt: '2026-10-01T10:00:00Z',
      }),
      buildPullRequestRow({
        id: 'github:pull_request:11',
        repository: kit.repository,
        mergeSha: null,
        mergedAt: null,
      }),
      buildPullRequestRow({
        id: 'github:pull_request:20',
        repository: app.repository,
        mergeSha: 'b1',
        mergedAt: '2026-10-01T12:00:00Z',
      }),
    ],
    bumps: [
      {
        pull_request_id: toTagged<EntityID>('github:pull_request:20'),
        release_repository: 'acme/kit',
        release_tag: 'v1.2.0',
      },
    ],
    releases: [
      buildReleaseRow({
        ...kit,
        id: 'github:release:1',
        tag: 'v1.1.0',
        target: 'r0',
        isDraft: false,
        publishedAt: '2026-10-01T09:05:00Z',
        deletedAt: null,
      }),
      buildReleaseRow({
        ...kit,
        id: 'github:release:2',
        tag: 'v1.2.0',
        target: 'r1',
        isDraft: false,
        publishedAt: '2026-10-01T11:05:00Z',
        deletedAt: null,
      }),
      buildReleaseRow({
        ...kit,
        id: 'github:release:3',
        tag: 'v1.3.0',
        target: 'r2',
        isDraft: true,
        publishedAt: null,
        deletedAt: null,
      }),
      buildReleaseRow({
        ...kit,
        id: 'github:release:4',
        tag: 'v1.3.1',
        target: 'r2',
        isDraft: false,
        publishedAt: '2026-10-01T10:30:00Z',
        deletedAt: '2026-10-01T10:40:00Z',
      }),
      buildReleaseRow({
        ...kit,
        id: 'github:release:5',
        tag: 'v1.4.0',
        target: 'r3',
        isDraft: false,
        publishedAt: '2026-10-01T13:05:00Z',
        deletedAt: null,
      }),
    ],
    commits: [
      buildCommitRow(kit.repository, 'r0', '2026-10-01T11:00:00+02:00'),
      buildCommitRow(kit.repository, 'm1', '2026-10-01T12:00:00+02:00'),
      buildCommitRow(kit.repository, 'r1', '2026-10-01T11:00:00Z'),
      buildCommitRow(kit.repository, 'r2', '2026-10-01T10:20:00Z'),
      buildCommitRow(kit.repository, 'r3', '2026-10-01T13:00:00Z'),
      buildCommitRow(app.repository, 'd0', '2026-10-01T11:30:00Z'),
      buildCommitRow(app.repository, 'b1', '2026-10-01T12:00:00Z'),
      buildCommitRow(app.repository, 'd1', '2026-10-01T12:30:00Z'),
    ],
    deploys: [
      buildDeployRow({
        environment: 'production',
        target: null,
        sha: 'd0',
        signal: 'tag',
        at: '2026-10-01T11:40:00.000Z',
      }),
      buildDeployRow({
        environment: 'production',
        target: null,
        sha: 'd1',
        signal: 'tag',
        at: '2026-10-01T12:40:00.000Z',
      }),
      buildDeployRow({
        environment: 'production',
        target: 'api',
        sha: 'd1',
        signal: 'tag',
        at: '2026-10-01T12:35:00.000Z',
      }),
      buildDeployRow({
        environment: 'production',
        target: null,
        sha: 'd1',
        signal: 'deployment_status',
        at: '2026-10-01T12:20:00Z',
      }),
      buildDeployRow({
        environment: 'staging',
        target: null,
        sha: 'd1',
        signal: 'deployment_status',
        at: '2026-10-01T12:50:00Z',
      }),
    ],
  };
}

interface PullRequestFields {
  id: string;
  repository: string;
  mergeSha: string | null;
  mergedAt: string | null;
}

// A `github_pull_request` row with the columns a delivery test decides.
export function buildPullRequestRow(fields: PullRequestFields) {
  return {
    id: toTagged<EntityID>(fields.id),
    number: 1,
    repository_id: toTagged<EntityID>(fields.repository),
    title: 'A change',
    state: fields.mergedAt === null ? 'open' : 'closed',
    is_draft: false,
    is_merged: fields.mergedAt !== null,
    author_id: null,
    url: 'https://github.example/pull/1',
    merge_commit_sha: fields.mergeSha,
    created_at: '2026-10-01T08:00:00Z',
    updated_at: '2026-10-01T08:00:00Z',
    closed_at: fields.mergedAt,
    merged_at: fields.mergedAt,
    payload: {},
  };
}

interface ReleaseFields {
  id: string;
  repository: string;
  repositoryName: string;
  tag: string;
  target: string;
  isDraft: boolean;
  createdAt: string;
  publishedAt: string | null;
  deletedAt: string | null;
}

// A `github_release` row with the columns a delivery test decides.
export function buildReleaseRow(fields: ReleaseFields) {
  return {
    id: toTagged<EntityID>(fields.id),
    repository_id: toTagged<EntityID>(fields.repository),
    repository_full_name: fields.repositoryName,
    tag_name: fields.tag,
    target_commitish: fields.target,
    name: fields.tag,
    url: `https://github.example/${fields.repositoryName}/releases/tag/${fields.tag}`,
    is_draft: fields.isDraft,
    is_prerelease: false,
    created_at: fields.createdAt,
    published_at: fields.publishedAt,
    updated_at: fields.publishedAt ?? fields.createdAt,
    deleted_at: fields.deletedAt,
  };
}

function buildCommitRow(repository: string, sha: string, committedAt: string) {
  return { repository_id: toTagged<EntityID>(repository), sha, committed_at: committedAt };
}

interface DeployFields {
  environment: string;
  target: string | null;
  sha: string;
  signal: 'tag' | 'deployment_status';
  at: string;
}

// A `github_deploy` row of the app repository, with its ID built as the consumer builds it.
function buildDeployRow(fields: DeployFields) {
  const targetPart = fields.target === null ? '' : `:${fields.target}`;

  return {
    id: toTagged<EntityID>(
      `github:deploy:2:${fields.environment}:${fields.signal}:${fields.sha}${targetPart}`,
    ),
    repository_id: toTagged<EntityID>(app.repository),
    environment: fields.environment,
    target: fields.target,
    sha: fields.sha,
    signal: fields.signal,
    deployed_at: fields.at,
  };
}
