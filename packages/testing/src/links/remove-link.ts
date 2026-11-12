import { isEntityID } from '@pepys/kit';
import type { StoreDatabase } from '../store-database/types.ts';
import type { WireLink } from '../utils/types.ts';

// No check runs on an unlink, and a stored link always joins two entity IDs, so an end that is no
// entity ID matches no link.
export async function removeLink(
  db: StoreDatabase,
  origin: string,
  link: Pick<WireLink, 'type' | 'from' | 'to'>,
): Promise<void> {
  const from = link.from;
  const to = link.to;

  if (!isEntityID(from) || !isEntityID(to)) {
    return;
  }

  await db
    .deleteFrom('link')
    .where('origin', '=', origin)
    .where('type', '=', link.type)
    .where('from_id', '=', from)
    .where('to_id', '=', to)
    .execute();
}
