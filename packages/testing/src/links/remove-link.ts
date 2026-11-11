import type { StoreDatabase } from '../store-database/types.ts';
import type { WireLink } from '../utils/types.ts';

export async function removeLink(
  db: StoreDatabase,
  origin: string,
  link: Pick<WireLink, 'type' | 'from' | 'to'>,
): Promise<void> {
  await db
    .deleteFrom('link')
    .where('origin', '=', origin)
    .where('type', '=', link.type)
    .where('from_id', '=', link.from)
    .where('to_id', '=', link.to)
    .execute();
}
