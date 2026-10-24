import { getGithubPullRequest } from '../generated/github-pull-request-boundary.ts';
import type {
  EntityID,
  GithubPullRequestOperation,
  GithubPullRequestRow,
} from '../generated/github-pull-request-boundary.ts';

export interface GithubPullRequestModel {
  operationsJSON: string;
}

export type GithubPullRequestMessage = { kind: 'apply'; factJSON: string } | { kind: 'reset' };

export function init(): GithubPullRequestModel {
  return { operationsJSON: '[]' };
}

export function update(
  model: GithubPullRequestModel,
  message: GithubPullRequestMessage,
): GithubPullRequestModel {
  if (message.kind === 'reset') {
    return init();
  }

  return { ...model, operationsJSON: applyFact(message.factJSON) };
}

export function applyFact(factJSON: string): string {
  return JSON.stringify(mapFact(factJSON));
}

function mapFact(factJSON: string): GithubPullRequestOperation[] {
  const row = readRow(factJSON);

  if (row === undefined) {
    return [];
  }

  const stored = getGithubPullRequest(row.id);

  if (stored !== undefined && stored.updated_at >= row.updated_at) {
    return [];
  }

  return [{ upsert: { github_pull_request: row } }];
}

function readRow(factJSON: string): GithubPullRequestRow | undefined {
  const fact: unknown = JSON.parse(factJSON);

  if (!isObject(fact) || !('payload' in fact) || !isObject(fact.payload)) {
    return undefined;
  }

  if (!('pull_request' in fact.payload) || !isObject(fact.payload.pull_request)) {
    return undefined;
  }

  const pullRequest = fact.payload.pull_request;

  if (!('id' in pullRequest) || typeof pullRequest.id !== 'number') {
    return undefined;
  }

  if (!('number' in pullRequest) || typeof pullRequest.number !== 'number') {
    return undefined;
  }

  if (!('title' in pullRequest) || typeof pullRequest.title !== 'string') {
    return undefined;
  }

  if (!('state' in pullRequest) || typeof pullRequest.state !== 'string') {
    return undefined;
  }

  if (!('html_url' in pullRequest) || typeof pullRequest.html_url !== 'string') {
    return undefined;
  }

  if (!('created_at' in pullRequest) || typeof pullRequest.created_at !== 'string') {
    return undefined;
  }

  if (!('updated_at' in pullRequest) || typeof pullRequest.updated_at !== 'string') {
    return undefined;
  }

  const repositoryID = readRepositoryID(pullRequest);

  if (repositoryID === undefined) {
    return undefined;
  }

  return {
    id: toEntityID(`github:pr:${pullRequest.id}`),
    number: pullRequest.number,
    repository_id: toEntityID(`github:repo:${repositoryID}`),
    title: pullRequest.title,
    state: pullRequest.state,
    is_draft: 'draft' in pullRequest && pullRequest.draft === true,
    is_merged: 'merged' in pullRequest && pullRequest.merged === true,
    author_id: readAuthorID(pullRequest),
    url: pullRequest.html_url,
    merge_commit_sha:
      'merge_commit_sha' in pullRequest && typeof pullRequest.merge_commit_sha === 'string'
        ? pullRequest.merge_commit_sha
        : null,
    created_at: pullRequest.created_at,
    updated_at: pullRequest.updated_at,
    closed_at:
      'closed_at' in pullRequest && typeof pullRequest.closed_at === 'string'
        ? pullRequest.closed_at
        : null,
    merged_at:
      'merged_at' in pullRequest && typeof pullRequest.merged_at === 'string'
        ? pullRequest.merged_at
        : null,
    payload: pullRequest,
  };
}

function readRepositoryID(pullRequest: object): number | undefined {
  if (!('base' in pullRequest) || !isObject(pullRequest.base)) {
    return undefined;
  }

  if (!('repo' in pullRequest.base) || !isObject(pullRequest.base.repo)) {
    return undefined;
  }

  if (!('id' in pullRequest.base.repo) || typeof pullRequest.base.repo.id !== 'number') {
    return undefined;
  }

  return pullRequest.base.repo.id;
}

function readAuthorID(pullRequest: object): EntityID | null {
  if (!('user' in pullRequest) || !isObject(pullRequest.user)) {
    return null;
  }

  if (!('id' in pullRequest.user) || typeof pullRequest.user.id !== 'number') {
    return null;
  }

  return toEntityID(`github:user:${pullRequest.user.id}`);
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEntityID(text: string): text is EntityID {
  return text.length > 0;
}

function toEntityID(text: string): EntityID {
  if (!isEntityID(text)) {
    throw new Error('an entity ID is never empty');
  }

  return text;
}
