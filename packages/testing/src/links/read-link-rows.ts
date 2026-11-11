import type { LinkRow } from '@pepys/kit';
import type { StoreDatabase } from '../store-database/types.ts';

// Every link, or every link of one consumer, in the order of its key.
export function readLinkRows(db: StoreDatabase, origin?: string): Promise<LinkRow[]> {
  const links = db.selectFrom('link').selectAll();

  return (origin === undefined ? links : links.where('origin', '=', origin))
    .orderBy('type')
    .orderBy('from_id')
    .orderBy('to_id')
    .orderBy('origin')
    .execute();
}
