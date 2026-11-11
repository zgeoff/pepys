import { initGithubRefModel, updateGithubRefModel } from '../generated/github-ref-boundary.ts';
import type {
  EntityID,
  GithubCommitRow,
  GithubRefMessage,
  GithubRefModel,
  GithubRefOperation,
} from '../generated/github-ref-boundary.ts';
import { findField } from '../utils/find-field.ts';

export type { GithubRefMessage, GithubRefModel } from '../generated/github-ref-boundary.ts';

// scriptc takes the model and message types through a re-export, but not the two functions
export function init(): GithubRefModel {
  return initGithubRefModel();
}

export function update(model: GithubRefModel, message: GithubRefMessage): GithubRefModel {
  return updateGithubRefModel(model, message);
}

export function applyFact(factJSON: string): string {
  return JSON.stringify(mapFact(factJSON));
}

// A commit's time is a property of the commit, so a row never changes, and a force push that drops
// a commit leaves a row that is still true.
function mapFact(factJSON: string): GithubRefOperation[] {
  const payload = findField(JSON.parse(factJSON), 'payload');
  const ref = findField(payload, 'ref');
  const repositoryID = findField(payload, 'repository', 'id');
  const defaultBranch = findField(payload, 'repository', 'default_branch');

  if (typeof ref !== 'string' || typeof repositoryID !== 'number') {
    return [];
  }

  const commits = collectPushedCommits(payload, ref, defaultBranch);
  const repository = toEntityID(`github:repo:${repositoryID}`);

  return commits.flatMap((commit) => {
    const row = buildCommitRow(repository, commit);

    return row === undefined ? [] : [{ upsert: { github_commit: row } }];
  });
}

// A tag push gives its head commit; a push to the default branch gives every commit it adds.
function collectPushedCommits(payload: unknown, ref: string, defaultBranch: unknown): unknown[] {
  if (ref.startsWith('refs/tags/')) {
    return [findField(payload, 'head_commit')];
  }

  if (ref === `refs/heads/${String(defaultBranch)}`) {
    return toList(findField(payload, 'commits'));
  }

  return [];
}

function toList(value: unknown): unknown[] {
  return Array.isArray(value) ? value.map((item: unknown) => item) : [];
}

// The time as GitHub writes it, with the committer's offset: scriptc fences `Date`, so a reader
// compares these times as times, never as text.
function buildCommitRow(repository: EntityID, commit: unknown): GithubCommitRow | undefined {
  const sha = findField(commit, 'id');
  const timestamp = findField(commit, 'timestamp');

  if (typeof sha !== 'string' || typeof timestamp !== 'string') {
    return undefined;
  }

  return { repository_id: repository, sha, committed_at: timestamp };
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
