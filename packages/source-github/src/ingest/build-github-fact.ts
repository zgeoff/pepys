import { parseFactEnvelope } from '@pepys/kit';
import type { PendingFact, StreamName } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { buildBodyHash } from '../utils/build-body-hash.ts';
import { githubEventRules } from './github-event-rules.ts';

// One delivery body of one webhook event as a fact. The ID is `webhook:github:h-<hash>` of the
// canonical body: GitHub signs the body and not the delivery ID header, so only the body decides it.
// The receive path and the recovery pull both build facts here, so one delivery has one ID on both.
export function buildGithubFact(event: string, body: unknown): PendingFact | 'ignored' | 'invalid' {
  const rule = Object.hasOwn(githubEventRules, event) ? githubEventRules[event] : undefined;

  if (rule === undefined) {
    return 'ignored';
  }

  const fields = rule.read(body);

  if (fields === 'ignored' || fields === 'invalid') {
    return fields;
  }

  const envelope = parseFactEnvelope({
    id: `webhook:github:h-${buildBodyHash(body)}`,
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
