import { parseFactEnvelope } from '@pepys/kit';
import type { PendingFact, StreamName } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { buildBodyHash } from '../utils/build-body-hash.ts';
import { githubEventRules } from './github-event-rules.ts';

// `delivery`: a webhook body, from the receive path or the recovery pull. `observation`: an object
// that the resync pull read from the API, in the shape of a webhook body.
export type GithubFactOrigin = 'delivery' | 'observation';

// One body of one webhook event as a fact, with an ID from the hash of the canonical body: GitHub
// signs the body and not the delivery ID header, so only the body decides it. One delivery has one
// ID on the receive path and on the recovery pull, and two reads of one state are one observation.
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
    id:
      origin === 'delivery'
        ? `webhook:github:h-${buildBodyHash(body)}`
        : `observation:${buildBodyHash(body)}`,
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
