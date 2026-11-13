import {
  initGithubPullRequestModel,
  readGithubPullRequestAliasRow,
  readGithubPullRequestRow,
  toGithubPullRequestID,
  updateGithubPullRequestModel,
} from '../generated/github-pull-request-boundary.ts';
import type {
  EntityID,
  GithubPullRequestAliasRow,
  GithubPullRequestMessage,
  GithubPullRequestModel,
  GithubPullRequestOperation,
  GithubPullRequestRow,
  GithubReleaseBumpRow,
} from '../generated/github-pull-request-boundary.ts';
import { findField } from '../utils/find-field.ts';

export type {
  GithubPullRequestMessage,
  GithubPullRequestModel,
} from '../generated/github-pull-request-boundary.ts';

// scriptc takes the model and message types through a re-export, but not the two functions
export function init(): GithubPullRequestModel {
  return initGithubPullRequestModel();
}

export function update(
  model: GithubPullRequestModel,
  message: GithubPullRequestMessage,
): GithubPullRequestModel {
  return updateGithubPullRequestModel(model, message);
}

export function applyFact(factJSON: string): string {
  return JSON.stringify(mapFact(factJSON));
}

function mapFact(factJSON: string): GithubPullRequestOperation[] {
  const row = readRow(factJSON);

  if (row === undefined) {
    return [];
  }

  const stored = readGithubPullRequestRow(row.id);

  if (stored !== undefined && isStale(stored, row)) {
    return [];
  }

  // The bump rows of the replaced body come from the stored payload, so a late fact of an older
  // body cannot bring back a bump that a newer body dropped.
  const given = collectReleaseBumps(row.id, row.payload);
  const replaced = stored === undefined ? [] : collectReleaseBumps(row.id, stored.payload);

  const givenKeys = new Set(given.map((bump) => JSON.stringify(bump)));
  const replacedKeys = new Set(replaced.map((bump) => JSON.stringify(bump)));

  const removed: GithubPullRequestOperation[] = replaced
    .filter((bump) => !givenKeys.has(JSON.stringify(bump)))
    .map((bump) => ({ delete: { github_release_bump: bump } }));

  const added: GithubPullRequestOperation[] = given
    .filter((bump) => !replacedKeys.has(JSON.stringify(bump)))
    .map((bump) => ({ upsert: { github_release_bump: bump } }));

  const aliases: GithubPullRequestOperation[] = collectAliases(row)
    .filter((alias) => shouldTakeAlias(alias, readGithubPullRequestAliasRow(alias.alias)))
    .map((alias) => ({ upsert: { github_pull_request_alias: alias } }));

  return [{ upsert: { github_pull_request: row } }, ...aliases, ...removed, ...added];
}

// The URL, and `<owner>/<repo>#<number>` when the URL has the `/<owner>/<repo>/pull/<number>`
// path. GitHub matches an owner and a repository in any case, so each alias is in lowercase.
function collectAliases(row: GithubPullRequestRow): GithubPullRequestAliasRow[] {
  const url = trimTrailingSlash(row.url.toLowerCase());

  const aliases: GithubPullRequestAliasRow[] = [
    { alias: url, entity_id: row.id, updated_at: row.updated_at },
  ];

  const parts = url.split('/');
  const [scheme, gap, host, owner, repository, pull, number] = parts;

  if (
    parts.length !== 7 ||
    scheme === undefined ||
    !scheme.endsWith(':') ||
    gap !== '' ||
    host === undefined ||
    host === '' ||
    owner === undefined ||
    owner === '' ||
    repository === undefined ||
    repository === '' ||
    pull !== 'pull' ||
    number !== `${row.number}`
  ) {
    return aliases;
  }

  aliases.push({
    alias: `${owner}/${repository}#${row.number}`,
    entity_id: row.id,
    updated_at: row.updated_at,
  });

  return aliases;
}

function trimTrailingSlash(text: string): string {
  return text.endsWith('/') ? text.slice(0, -1) : text;
}

// The holder's own row is no guide after a rename, since its newest fact may name another
// repository. The alias time keeps the outcome free of arrival order, and a tie between two pull
// requests goes to the later fact, as it does for the pull request row.
function shouldTakeAlias(
  alias: GithubPullRequestAliasRow,
  holding: GithubPullRequestAliasRow | undefined,
): boolean {
  if (holding === undefined) {
    return true;
  }

  if (holding.updated_at !== alias.updated_at) {
    return holding.updated_at < alias.updated_at;
  }

  return holding.entity_id !== alias.entity_id;
}

const releaseURLStart = 'https://github.com/';
const releaseURLEnds = [' ', '\n', '\r', '\t', ')', ']', '>', '"', "'", '`', '#', '?'];

// One row per `https://github.com/<owner>/<name>/releases/tag/<tag>` URL in the body of a pull
// request whose author is a bot, each once, with the tag percent-decoded.
function collectReleaseBumps(
  pullRequestID: GithubReleaseBumpRow['pull_request_id'],
  pullRequest: unknown,
): GithubReleaseBumpRow[] {
  const body = findField(pullRequest, 'body');

  if (findField(pullRequest, 'user', 'type') !== 'Bot' || typeof body !== 'string') {
    return [];
  }

  const bumps: GithubReleaseBumpRow[] = [];
  const seen: string[] = [];

  for (const part of body.split(releaseURLStart).slice(1)) {
    const bump = parseReleaseURLPath(part);

    if (bump === undefined || seen.includes(`${bump.repository}\n${bump.tag}`)) {
      continue;
    }

    seen.push(`${bump.repository}\n${bump.tag}`);

    bumps.push({
      pull_request_id: pullRequestID,
      release_repository: bump.repository,
      release_tag: bump.tag,
    });
  }

  return bumps;
}

// `<owner>/<name>/releases/tag/<tag>`, up to the first character that ends a URL in text. GitHub
// serves a tag that holds `/` both escaped and unescaped, so the tag is the rest of the path.
function parseReleaseURLPath(text: string): { repository: string; tag: string } | undefined {
  let end = text.length;

  for (const mark of releaseURLEnds) {
    const at = text.indexOf(mark);

    if (at !== -1 && at < end) {
      end = at;
    }
  }

  const parts = text.slice(0, end).split('/');
  const [owner, name, releases, tagWord] = parts;
  const tagParts = parts.slice(4);
  const tag = tagParts.join('/');

  if (parts.length < 5 || releases !== 'releases' || tagWord !== 'tag') {
    return undefined;
  }

  if (owner === undefined || name === undefined) {
    return undefined;
  }

  if (owner === '' || name === '' || tagParts.includes('')) {
    return undefined;
  }

  const decoded = decodeTag(tag);

  return decoded === undefined ? undefined : { repository: `${owner}/${name}`, tag: decoded };
}

function decodeTag(tag: string): string | undefined {
  try {
    return decodeURIComponent(tag);
  } catch {
    return undefined;
  }
}

// Two updates can share one second. A repeat of the stored row changes nothing, and a different
// row with the same update time is a distinct update, so the later fact in the stream wins. The
// host skips a fact it has applied before, so a redelivery never reaches this check.
function isStale(stored: GithubPullRequestRow, row: GithubPullRequestRow): boolean {
  if (stored.updated_at !== row.updated_at) {
    return stored.updated_at > row.updated_at;
  }

  return JSON.stringify(stored) === JSON.stringify(row);
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
    id: toGithubPullRequestID(`${pullRequest.id}`),
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
