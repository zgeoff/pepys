import { isEntityID } from '@pepys/kit';
import type { EntityID } from '@pepys/kit';
import invariant from 'tiny-invariant';
import type { StoreDatabase } from '../store-database/types.ts';
import type { WireLink } from '../utils/types.ts';

// Writes the link of `origin`, the consumer's name, with the scope that owns it, or null in fact
// mode. The link has passed the link check.
export async function writeLink(
  db: StoreDatabase,
  origin: string,
  scope: EntityID | null,
  link: WireLink,
): Promise<void> {
  const from = link.from;
  const to = link.to;

  invariant(isEntityID(from) && isEntityID(to), 'a checked link joins two entity IDs');

  await db
    .replaceInto('link')
    .values({
      type: link.type,
      from_id: from,
      to_id: to,
      scope,
      origin,
      confidence: link.confidence,
      evidence: link.evidence,
    })
    .execute();
}
