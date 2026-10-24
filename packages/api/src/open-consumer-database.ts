import { connect } from '@tursodatabase/database';
import type { Database } from '@tursodatabase/database';

export function openConsumerDatabase(path: string): Promise<Database> {
  return connect(path, { readonly: true, experimental: ['multiprocess_wal'] });
}
