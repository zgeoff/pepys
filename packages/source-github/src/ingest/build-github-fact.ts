import { parseFactEnvelope } from '@pepys/kit';
import type { PendingFact, StreamName } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { match } from 'ts-pattern';
import { buildBodyHash } from './build-body-hash.ts';
import { githubEventRules } from './github-event-rules.ts';

// `delivery`: a webhook body, from the receive path or the recovery pull. `observation`: an object
// that the resync pull read from the API, in the shape of a webhook body, for a mark whose last
// stored body has the digest `lastBodyDigest`.
export type GithubFactOrigin =
  | { kind: 'delivery' }
  | { kind: 'observation'; lastBodyDigest: string | undefined };

// One body of one webhook event as a fact, with an ID from the hash of the canonical body: GitHub
// signs the body and not the delivery ID header, so only the body decides it. An observation's ID
// also hashes the last stored body, so a read after a newer tied body is a fact the host applies.
export function buildGithubFact(
  event: string,
  body: unknown,
  origin: GithubFactOrigin,
): PendingFact | 'ignored' | 'invalid' {
  const rule = Object.hasOwn(githubEventRules, event) ? githubEventRules[event] : undefined;

  if (rule === undefined) {
    return 'ignored';
  }

  const fields = rule.read(body);

  if (fields === 'ignored' || fields === 'invalid') {
    return fields;
  }

  const envelope = parseFactEnvelope({
    id: match(origin)
      .with({ kind: 'delivery' }, () => `webhook:github:h-${buildBodyHash(body)}`)
      .with(
        { kind: 'observation' },
        (observation) => `observation:${buildObservationHash(body, observation.lastBodyDigest)}`,
      )
      .exhaustive(),
    type: fields.type,
    v: 1,
    api: rule.family.api,
    entity: fields.entity,
    ...(fields.actor === undefined ? {} : { actor: fields.actor }),
    at: fields.at,
    payload: body,
  });

  if (!envelope.ok) {
    return 'invalid';
  }

  return {
    stream: toTagged<StreamName>(rule.family.stream),
    fact: envelope.value,
    blobs: [],
    ...(fields.locator === undefined ? {} : { locator: fields.locator }),
  };
}

function buildObservationHash(body: unknown, lastBodyDigest: string | undefined): string {
  return lastBodyDigest === undefined
    ? buildBodyHash(body)
    : buildBodyHash({ observed: body, lastBodyDigest });
}
