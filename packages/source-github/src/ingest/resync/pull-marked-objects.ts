import { parseFactEnvelope } from '@pepys/kit';
import type { PendingFact, PullContext, Pulled, StreamName } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { z } from 'zod';
import { releaseFamily } from '../../families/release-family.ts';
import { buildBodyHash } from '../../utils/build-body-hash.ts';
import { buildGithubFact } from '../build-github-fact.ts';
import { findAppJWT } from '../github-app/find-app-jwt.ts';
import { pickPullFailure } from '../github-app/pick-pull-failure.ts';
import { readInstallationToken } from '../github-app/read-installation-token.ts';
import type { InstallationToken } from '../github-app/read-installation-token.ts';
import { requestGithubAPI } from '../github-app/request-github-api.ts';
import { collectResyncTargets } from './collect-resync-targets.ts';
import type { ResyncTarget } from './collect-resync-targets.ts';

// The resync pull: each marked pull request and release, read again from the API as one fact in the
// shape of its webhook body. The fact comes after the deliveries, so it wins a tie of times and sets
// the row to GitHub's state. A release the API no longer has gives a `deleted` fact.
export async function pullMarkedObjects(
  _cursor: string | null,
  context: PullContext,
): Promise<Pulled> {
  const targets = collectResyncTargets(context.marks);
  const nowMs = Date.now();

  if (targets.length === 0) {
    return { kind: 'batch', batch: { facts: [] }, cursor: 'resynced', isDone: true };
  }

  const appJWT = findAppJWT(context.env, nowMs);

  if (appJWT === undefined) {
    return { kind: 'rejected', reason: 'the GitHub App private key cannot sign a token' };
  }

  const tokens = new Map<string, InstallationToken>();

  const facts: PendingFact[] = [];

  for (const target of targets) {
    const token = await readCachedToken(tokens, target.repository, appJWT);

    if (token.kind === 'failed') {
      return pickPullFailure(token.status);
    }

    if (token.kind === 'not-installed') {
      continue;
    }

    const read = await readObject(target, token.token, nowMs);

    if (read.kind === 'failed') {
      return pickPullFailure(read.status);
    }

    if (read.kind === 'fact') {
      facts.push(read.fact);
    }
  }

  return { kind: 'batch', batch: { facts }, cursor: 'resynced', isDone: true };
}

// one installation token per repository in one run
async function readCachedToken(
  tokens: Map<string, InstallationToken>,
  repository: string,
  appJWT: string,
): Promise<InstallationToken> {
  const known = tokens.get(repository);

  if (known !== undefined) {
    return known;
  }

  const token = await readInstallationToken(repository, appJWT);

  tokens.set(repository, token);

  return token;
}

const repositorySchema = z.looseObject({ id: z.number().int(), full_name: z.string() });

type ReadObject =
  | { kind: 'fact'; fact: PendingFact }
  | { kind: 'none' }
  | { kind: 'failed'; status: number };

// A pull request the API does not give is left alone: GitHub deletes none, so the App lost access.
async function readObject(target: ResyncTarget, token: string, nowMs: number): Promise<ReadObject> {
  const answer = await requestGithubAPI(target.path, token);

  if (answer.status === 404) {
    return target.kind === 'release'
      ? toReadObject(buildDeletedFact(target, nowMs))
      : { kind: 'none' };
  }

  if (answer.status !== 200) {
    return { kind: 'failed', status: answer.status };
  }

  if (target.kind === 'pull_request') {
    return toReadObject(
      buildGithubFact(
        'pull_request',
        { action: 'resynced', pull_request: answer.body },
        'observation',
      ),
    );
  }

  const repository = await requestGithubAPI(`/repos/${target.repository}`, token);

  const parsed = repositorySchema.safeParse(repository.body);

  if (repository.status !== 200 || !parsed.success) {
    return { kind: 'failed', status: repository.status };
  }

  // only the two fields the release consumer reads, so the hash moves with the release alone
  const body = {
    action: 'resynced',
    release: answer.body,
    repository: { id: parsed.data.id, full_name: parsed.data.full_name },
  };

  return toReadObject(buildGithubFact('release', body, 'observation'));
}

function toReadObject(fact: PendingFact | 'ignored' | 'invalid'): ReadObject {
  return typeof fact === 'string' ? { kind: 'none' } : { kind: 'fact', fact };
}

// The time of a delete is when the pull saw it. The ID hashes the payload alone, so two pulls that
// see one delete give one fact.
function buildDeletedFact(target: ResyncTarget, nowMs: number): PendingFact | 'invalid' {
  const payload = { action: 'deleted', release: { id: Number(target.path.split('/').at(-1)) } };

  const envelope = parseFactEnvelope({
    id: `observation:${buildBodyHash(payload)}`,
    type: 'github.release.deleted',
    v: 1,
    api: releaseFamily.api,
    entity: target.entity,
    at: new Date(nowMs).toISOString(),
    payload,
  });

  if (!envelope.ok) {
    return 'invalid';
  }

  return { stream: toTagged<StreamName>(releaseFamily.stream), fact: envelope.value, blobs: [] };
}
