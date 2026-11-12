import type { AppliedFact } from '@pepys/testing';
import type { githubSource } from '../github-source.ts';

type GithubAppliedFact = AppliedFact<typeof githubSource>;

const kit = { id: 1, fullName: 'acme/kit', createdAt: '2026-10-01T08:00:00Z' };
const app = { id: 2 };

// Kit pull request 10 merges at m1; 11 stays open. Release 2 is the first published one after m1.
// App bot pull request 20 bumps the kit to it and merges at b1, then the app deploys d1 to
// production, with and without the target `api`, and to staging by deployment status only.
export function buildDeliveryFacts(): GithubAppliedFact[] {
  return [
    buildPullRequestFact({
      id: 10,
      repositoryID: kit.id,
      mergeSha: 'm1',
      mergedAt: '2026-10-01T10:00:00Z',
      body: null,
    }),
    buildPullRequestFact({
      id: 11,
      repositoryID: kit.id,
      mergeSha: null,
      mergedAt: null,
      body: null,
    }),
    buildPullRequestFact({
      id: 20,
      repositoryID: app.id,
      mergeSha: 'b1',
      mergedAt: '2026-10-01T12:00:00Z',
      body: 'Bumps the kit: https://github.com/acme/kit/releases/tag/v1.2.0',
    }),
    buildReleaseFact('published', '2026-10-01T09:05:00Z', {
      id: 1,
      tag: 'v1.1.0',
      target: 'r0',
      isDraft: false,
      publishedAt: '2026-10-01T09:05:00Z',
    }),
    buildReleaseFact('published', '2026-10-01T11:05:00Z', {
      id: 2,
      tag: 'v1.2.0',
      target: 'r1',
      isDraft: false,
      publishedAt: '2026-10-01T11:05:00Z',
    }),
    buildReleaseFact('created', kit.createdAt, {
      id: 3,
      tag: 'v1.3.0',
      target: 'r2',
      isDraft: true,
      publishedAt: null,
    }),
    buildReleaseFact('published', '2026-10-01T10:30:00Z', {
      id: 4,
      tag: 'v1.3.1',
      target: 'r2',
      isDraft: false,
      publishedAt: '2026-10-01T10:30:00Z',
    }),
    buildReleaseFact('deleted', '2026-10-01T10:40:00Z', {
      id: 4,
      tag: 'v1.3.1',
      target: 'r2',
      isDraft: false,
      publishedAt: '2026-10-01T10:30:00Z',
    }),
    buildReleaseFact('published', '2026-10-01T13:05:00Z', {
      id: 5,
      tag: 'v1.4.0',
      target: 'r3',
      isDraft: false,
      publishedAt: '2026-10-01T13:05:00Z',
    }),
    buildPushFact(kit.id, 'refs/heads/main', '2026-10-01T13:00:00Z', [
      { sha: 'r0', timestamp: '2026-10-01T11:00:00+02:00' },
      { sha: 'm1', timestamp: '2026-10-01T12:00:00+02:00' },
      { sha: 'r1', timestamp: '2026-10-01T11:00:00Z' },
      { sha: 'r2', timestamp: '2026-10-01T10:20:00Z' },
      { sha: 'r3', timestamp: '2026-10-01T13:00:00Z' },
    ]),
    buildPushFact(app.id, 'refs/heads/main', '2026-10-01T12:30:00Z', [
      { sha: 'd0', timestamp: '2026-10-01T11:30:00Z' },
      { sha: 'b1', timestamp: '2026-10-01T12:00:00Z' },
      { sha: 'd1', timestamp: '2026-10-01T12:30:00Z' },
    ]),
    buildPushFact(app.id, 'refs/tags/deployed/production', '2026-10-01T11:40:00.000Z', [
      { sha: 'd0', timestamp: '2026-10-01T11:30:00Z' },
    ]),
    buildPushFact(app.id, 'refs/tags/deployed/production', '2026-10-01T12:40:00.000Z', [
      { sha: 'd1', timestamp: '2026-10-01T12:30:00Z' },
    ]),
    buildPushFact(app.id, 'refs/tags/deployed/production/api', '2026-10-01T12:35:00.000Z', [
      { sha: 'd1', timestamp: '2026-10-01T12:30:00Z' },
    ]),
    buildDeploymentStatusFact(
      { id: 71, environment: 'production', sha: 'd1' },
      '2026-10-01T12:20:00Z',
    ),
    buildDeploymentStatusFact(
      { id: 72, environment: 'staging', sha: 'd1' },
      '2026-10-01T12:50:00Z',
    ),
  ];
}

interface PullRequestFields {
  id: number;
  repositoryID: number;
  mergeSha: string | null;
  mergedAt: string | null;

  // a pull request with a body is a bot's, as a release bump is
  body: string | null;
}

function buildPullRequestFact(fields: PullRequestFields): GithubAppliedFact {
  const isMerged = fields.mergedAt !== null;

  return {
    type: isMerged ? 'github.pull_request.closed' : 'github.pull_request.opened',
    event: `pull_request-${fields.id}`,
    entity: `github:pull_request:${fields.id}`,
    at: fields.mergedAt ?? kit.createdAt,
    payload: {
      action: isMerged ? 'closed' : 'opened',
      pull_request: {
        id: fields.id,
        number: fields.id,
        title: 'A change',
        state: isMerged ? 'closed' : 'open',
        html_url: `https://github.example/pull/${fields.id}`,
        user: { id: 9001, type: fields.body === null ? 'User' : 'Bot' },
        base: { repo: { id: fields.repositoryID } },
        body: fields.body,
        merged: isMerged,
        merge_commit_sha: fields.mergeSha,
        created_at: kit.createdAt,
        updated_at: fields.mergedAt ?? kit.createdAt,
        closed_at: fields.mergedAt,
        merged_at: fields.mergedAt,
      },
    },
  };
}

interface ReleaseFields {
  id: number;
  tag: string;
  target: string;
  isDraft: boolean;
  publishedAt: string | null;
}

function buildReleaseFact(
  action: 'created' | 'published' | 'deleted',
  at: string,
  fields: ReleaseFields,
): GithubAppliedFact {
  return {
    type: `github.release.${action}`,
    event: `release-${fields.id}-${action}`,
    entity: `github:release:${fields.id}`,
    at,
    payload: {
      action,
      release: {
        id: fields.id,
        tag_name: fields.tag,
        target_commitish: fields.target,
        name: fields.tag,
        html_url: `https://github.example/${kit.fullName}/releases/tag/${fields.tag}`,
        draft: fields.isDraft,
        prerelease: false,
        created_at: kit.createdAt,
        published_at: fields.publishedAt,
      },
      repository: { id: kit.id, full_name: kit.fullName },
    },
  };
}

interface PushedCommit {
  sha: string;
  timestamp: string;
}

// The last commit is the head commit, which a tag push names.
function buildPushFact(
  repositoryID: number,
  ref: string,
  at: string,
  commits: readonly PushedCommit[],
): GithubAppliedFact {
  const head = commits.at(-1);

  return {
    type: 'github.ref.pushed',
    event: `push-${repositoryID}-${ref}-${at}`,
    entity: `github:ref:${repositoryID}:${ref}`,
    at,
    payload: {
      ref,
      repository: { id: repositoryID, default_branch: 'main' },
      commits: commits.map((commit) => ({ id: commit.sha, timestamp: commit.timestamp })),
      head_commit: head === undefined ? null : { id: head.sha, timestamp: head.timestamp },
    },
  };
}

interface DeploymentFields {
  id: number;
  environment: string;
  sha: string;
}

function buildDeploymentStatusFact(fields: DeploymentFields, at: string): GithubAppliedFact {
  return {
    type: 'github.deployment.status_created',
    event: `deployment_status-${fields.id}`,
    entity: `github:deployment:${fields.id}`,
    at,
    payload: {
      deployment: { id: fields.id, environment: fields.environment, sha: fields.sha },
      deployment_status: { state: 'success' },
      repository: { id: app.id },
    },
  };
}
