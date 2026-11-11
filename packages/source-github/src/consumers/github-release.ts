import {
  initGithubReleaseModel,
  readGithubReleaseRow,
  toGithubReleaseID,
  updateGithubReleaseModel,
} from '../generated/github-release-boundary.ts';
import type {
  EntityID,
  GithubReleaseMessage,
  GithubReleaseModel,
  GithubReleaseOperation,
  GithubReleaseRow,
} from '../generated/github-release-boundary.ts';
import { findField } from '../utils/find-field.ts';

export type {
  GithubReleaseMessage,
  GithubReleaseModel,
} from '../generated/github-release-boundary.ts';

// scriptc takes the model and message types through a re-export, but not the two functions
export function init(): GithubReleaseModel {
  return initGithubReleaseModel();
}

export function update(
  model: GithubReleaseModel,
  message: GithubReleaseMessage,
): GithubReleaseModel {
  return updateGithubReleaseModel(model, message);
}

export function applyFact(factJSON: string): string {
  return JSON.stringify(mapFact(factJSON));
}

// GitHub never uses a release ID again, so a tombstone is never cleared. On a tie of times the
// later fact in the stream wins: the host gives each fact ID once, so every replay keeps that order.
function mapFact(factJSON: string): GithubReleaseOperation[] {
  const fact: unknown = JSON.parse(factJSON);
  const type = findField(fact, 'type');
  const at = findField(fact, 'at');
  const releaseID = findField(fact, 'payload', 'release', 'id');

  if (typeof at !== 'string' || typeof releaseID !== 'number') {
    return [];
  }

  const id = toGithubReleaseID(`${releaseID}`);
  const stored = readGithubReleaseRow(id);
  const isDelete = type === 'github.release.deleted';
  const deletedAt = stored?.deleted_at ?? (isDelete ? at : null);
  const given = buildReleaseRow(id, findField(fact, 'payload'), at);
  const wins = given !== undefined && (stored === undefined || at >= stored.updated_at);
  const row = wins ? given : stored;

  if (row === undefined) {
    return [];
  }

  const next: GithubReleaseRow = { ...row, deleted_at: deletedAt };

  if (stored !== undefined && JSON.stringify(stored) === JSON.stringify(next)) {
    return [];
  }

  return [{ upsert: { github_release: next } }];
}

// A `deleted` fact of the resync pull holds the release ID alone, and gives no row of its own.
function buildReleaseRow(
  id: GithubReleaseRow['id'],
  payload: unknown,
  at: string,
): GithubReleaseRow | undefined {
  const release = findField(payload, 'release');
  const repositoryID = findField(payload, 'repository', 'id');
  const fullName = findField(payload, 'repository', 'full_name');
  const tagName = findField(release, 'tag_name');
  const target = findField(release, 'target_commitish');
  const name = findField(release, 'name');
  const url = findField(release, 'html_url');
  const createdAt = findField(release, 'created_at');
  const publishedAt = findField(release, 'published_at');

  if (typeof repositoryID !== 'number' || typeof fullName !== 'string') {
    return undefined;
  }

  if (typeof tagName !== 'string' || typeof target !== 'string' || typeof url !== 'string') {
    return undefined;
  }

  if (typeof createdAt !== 'string') {
    return undefined;
  }

  return {
    id,
    repository_id: toEntityID(`github:repo:${repositoryID}`),
    repository_full_name: fullName,
    tag_name: tagName,
    target_commitish: target,
    name: typeof name === 'string' && name !== '' ? name : tagName,
    url,
    is_draft: findField(release, 'draft') === true,
    is_prerelease: findField(release, 'prerelease') === true,
    created_at: createdAt,
    published_at: typeof publishedAt === 'string' ? publishedAt : null,
    updated_at: at,
    deleted_at: null,
  };
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
