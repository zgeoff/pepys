import {
  initGithubDeployModel,
  readGithubDeployRow,
  settings,
  toGithubDeployID,
  updateGithubDeployModel,
} from '../generated/github-deploy-boundary.ts';
import type {
  EntityID,
  GithubDeployMessage,
  GithubDeployModel,
  GithubDeployOperation,
  GithubDeployRow,
} from '../generated/github-deploy-boundary.ts';
import type { DeploySignal } from '../utils/deploy-signals.ts';
import { findField } from '../utils/find-field.ts';

export type {
  GithubDeployMessage,
  GithubDeployModel,
} from '../generated/github-deploy-boundary.ts';

// scriptc takes the model and message types through a re-export, but not the two functions
export function init(): GithubDeployModel {
  return initGithubDeployModel();
}

export function update(model: GithubDeployModel, message: GithubDeployMessage): GithubDeployModel {
  return updateGithubDeployModel(model, message);
}

export function applyFact(factJSON: string): string {
  return JSON.stringify(mapFact(factJSON));
}

interface DeployReport {
  repositoryID: number;
  environment: string;
  target: string | null;
  sha: string;
  signal: DeploySignal;
  at: string;
}

// The row says "this signal reported this commit", so it keeps the earliest time: a second report
// of one commit, in any order, changes nothing.
function mapFact(factJSON: string): GithubDeployOperation[] {
  const fact: unknown = JSON.parse(factJSON);
  const report = pickDeployReport(fact);

  if (report === undefined) {
    return [];
  }

  const target = report.target === null ? '' : `:${report.target}`;

  const id = toGithubDeployID(
    `${report.repositoryID}:${report.environment}:${report.signal}:${report.sha}${target}`,
  );

  const stored = readGithubDeployRow(id);

  if (stored !== undefined && stored.deployed_at <= report.at) {
    return [];
  }

  const row: GithubDeployRow = {
    id,
    repository_id: toEntityID(`github:repo:${report.repositoryID}`),
    environment: report.environment,
    target: report.target,
    sha: report.sha,
    signal: report.signal,
    deployed_at: report.at,
  };

  return [{ upsert: { github_deploy: row } }];
}

function pickDeployReport(fact: unknown): DeployReport | undefined {
  const type = findField(fact, 'type');
  const at = findField(fact, 'at');
  const payload = findField(fact, 'payload');

  if (typeof at !== 'string') {
    return undefined;
  }

  if (type === 'github.ref.pushed') {
    return pickTagReport(payload, at);
  }

  if (type === 'github.deployment.status_created') {
    return pickStatusReport(payload, at);
  }

  return undefined;
}

// A push that moves a tag of the deploy tag pattern to a commit. A push that deletes the tag names
// no commit.
function pickTagReport(payload: unknown, at: string): DeployReport | undefined {
  const ref = findField(payload, 'ref');
  const sha = findField(payload, 'head_commit', 'id');
  const repositoryID = findField(payload, 'repository', 'id');

  if (typeof ref !== 'string' || !ref.startsWith('refs/tags/') || typeof sha !== 'string') {
    return undefined;
  }

  if (findField(payload, 'deleted') === true || typeof repositoryID !== 'number') {
    return undefined;
  }

  const tag = findTagDeploy(ref.slice('refs/tags/'.length), settings.deployTagPattern);

  if (tag === undefined) {
    return undefined;
  }

  return { repositoryID, ...tag, sha, signal: 'tag', at };
}

// The tag is the pattern with an environment in place of `<environment>`, and may end with
// `/<target>`. Neither part is empty or holds a `/`.
function findTagDeploy(
  tag: string,
  pattern: string,
): { environment: string; target: string | null } | undefined {
  const marker = '<environment>';
  const markerAt = pattern.indexOf(marker);
  const before = pattern.slice(0, markerAt);
  const after = pattern.slice(markerAt + marker.length);

  if (markerAt === -1 || !tag.startsWith(before)) {
    return undefined;
  }

  const rest = tag.slice(before.length);
  const environmentEnd = after === '' ? getPartEnd(rest) : rest.indexOf(after);

  if (environmentEnd <= 0) {
    return undefined;
  }

  const environment = rest.slice(0, environmentEnd);
  const tail = rest.slice(environmentEnd + after.length);

  if (environment.includes('/')) {
    return undefined;
  }

  if (tail === '') {
    return { environment, target: null };
  }

  const target = tail.slice(1);

  if (!tail.startsWith('/') || target === '' || target.includes('/')) {
    return undefined;
  }

  return { environment, target };
}

function getPartEnd(text: string): number {
  const slash = text.indexOf('/');

  return slash === -1 ? text.length : slash;
}

function pickStatusReport(payload: unknown, at: string): DeployReport | undefined {
  const state = findField(payload, 'deployment_status', 'state');
  const environment = findField(payload, 'deployment', 'environment');
  const sha = findField(payload, 'deployment', 'sha');
  const repositoryID = findField(payload, 'repository', 'id');

  if (state !== 'success' || typeof environment !== 'string' || environment === '') {
    return undefined;
  }

  if (typeof sha !== 'string' || typeof repositoryID !== 'number') {
    return undefined;
  }

  return { repositoryID, environment, target: null, sha, signal: 'deployment_status', at };
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
