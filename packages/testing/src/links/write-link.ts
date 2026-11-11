import type { StoreDatabase } from '../store-database/types.ts';
import type { WireLink } from '../utils/types.ts';

// Writes the link of `origin`, the consumer's name, with the scope that owns it, or null in fact
// mode.
export async function writeLink(
  db: StoreDatabase,
  origin: string,
  scope: string | null,
  link: WireLink,
): Promise<void> {
  await db
    .replaceInto('link')
    .values({
      type: link.type,
      from_id: link.from,
      to_id: link.to,
      scope,
      origin,
      confidence: link.confidence,
      evidence: link.evidence,
    })
    .execute();
}
