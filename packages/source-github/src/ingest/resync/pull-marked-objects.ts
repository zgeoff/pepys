import type { PendingFact, PullContext, Pulled } from '@pepys/kit';
import { z } from 'zod';
import { buildGithubFact } from '../build-github-fact.ts';
import type { GithubFactOrigin } from '../build-github-fact.ts';
import { findAppJWT } from '../github-app/find-app-jwt.ts';
import { pickPullFailure } from '../github-app/pick-pull-failure.ts';
import { readInstallationToken } from '../github-app/read-installation-token.ts';
import type { InstallationToken } from '../github-app/read-installation-token.ts';
import { requestGithubAPI } from '../github-app/request-github-api.ts';
import type { GithubCall } from '../github-app/request-github-api.ts';
import { collectResyncTargets } from './collect-resync-targets.ts';
import type { ResyncTarget } from './collect-resync-targets.ts';

// The resync pull: each marked pull request and release, read again from the API as one fact in the
// shape of its webhook body. The fact comes after the deliveries, so it wins a tie of times and sets
// the row to GitHub's state.
export async function pullMarkedObjects(
  _cursor: string | null,
  context: PullContext,
): Promise<Pulled> {
  const targets = collectResyncTargets(context.marks);

  if (targets.length === 0) {
    return { kind: 'batch', batch: { facts: [] }, cursor: 'resynced', isDone: true };
  }

  const appJWT = findAppJWT(context.env, context.now());

  if (appJWT === undefined) {
    return { kind: 'rejected', reason: 'the GitHub App private key cannot sign a token' };
  }

  const tokens = new Map<string, InstallationToken>();

  const facts: PendingFact[] = [];

  for (const target of targets) {
    const token = await readCachedToken(tokens, target.repository, appJWT, context);

    if (token.kind === 'failed') {
      return pickPullFailure(token.status);
    }

    if (token.kind === 'not-installed') {
      continue;
    }

    const read = await readObject(target, token.token, context);

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
  call: GithubCall,
): Promise<InstallationToken> {
  const known = tokens.get(repository);

  if (known !== undefined) {
    return known;
  }

  const token = await readInstallationToken(repository, appJWT, call);

  tokens.set(repository, token);

  return token;
}

const repositorySchema = z.looseObject({ id: z.number().int(), full_name: z.string() });

type ReadObject =
  | { kind: 'fact'; fact: PendingFact }
  | { kind: 'none' }
  | { kind: 'failed'; status: number };

// An object the API answers 404 for is left alone. GitHub deletes no pull request, and shows a draft
// release only to a token that can push, so a 404 cannot prove a delete. A deleted release's own
// `deleted` delivery sets its tombstone.
async function readObject(
  target: ResyncTarget,
  token: string,
  call: GithubCall,
): Promise<ReadObject> {
  const answer = await requestGithubAPI(target.path, token, call);

  if (answer.status === 404) {
    return { kind: 'none' };
  }

  if (answer.status !== 200) {
    return { kind: 'failed', status: answer.status };
  }

  const origin: GithubFactOrigin = { kind: 'observation', lastBodyDigest: target.lastBodyDigest };

  if (target.kind === 'pull_request') {
    return toReadObject(
      buildGithubFact('pull_request', { action: 'resynced', pull_request: answer.body }, origin),
    );
  }

  const repository = await requestGithubAPI(`/repos/${target.repository}`, token, call);

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

  return toReadObject(buildGithubFact('release', body, origin));
}

function toReadObject(fact: PendingFact | 'ignored' | 'invalid'): ReadObject {
  return typeof fact === 'string' ? { kind: 'none' } : { kind: 'fact', fact };
}
