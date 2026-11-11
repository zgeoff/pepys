import type { PendingFact } from '@pepys/kit';
import type { AppliedFact } from '@pepys/testing';
import invariant from 'tiny-invariant';
import { githubSource } from '../github-source.ts';

type GithubAppliedFact = AppliedFact<typeof githubSource>;

// A fact that ingest stored, in the form the test store applies. The store builds every ID as
// `event:github:<event>`, so the event keeps what tells two IDs apart: one fact ID gives one event,
// and the store skips a copy as the host does.
export function toAppliedFact(pending: PendingFact): GithubAppliedFact {
  const fact = pending.fact;

  const event = fact.id.startsWith('webhook:github:')
    ? fact.id.slice('webhook:github:'.length)
    : fact.id.replace(':', '-');

  const applied = {
    type: fact.type,
    event,
    entity: fact.entity,
    ...(fact.actor === undefined ? {} : { actor: fact.actor }),
    at: fact.at,
    payload: fact.payload,
  };

  invariant(isGithubAppliedFact(applied), 'a stored fact has a type of the GitHub source');

  return applied;
}

interface TypedFact {
  type: string;
  entity: string;
}

function isGithubAppliedFact(value: TypedFact): value is GithubAppliedFact & typeof value {
  const family = githubSource.families.find((candidate) =>
    Object.hasOwn(candidate.types, value.type),
  );

  return family !== undefined && value.entity.startsWith(`${family.entityKind}:`);
}
