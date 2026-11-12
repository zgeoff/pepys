import type { ConsumerDeclaration, EntityID } from '@pepys/kit';
import { removeLink } from '../links/remove-link.ts';
import { writeLink } from '../links/write-link.ts';
import { removeRow } from '../rows/remove-row.ts';
import { writeRow } from '../rows/write-row.ts';
import type { StoreDatabase } from '../store-database/types.ts';
import type { ScopeChanges } from './types.ts';

export async function writeScopeChanges(
  db: StoreDatabase,
  consumer: ConsumerDeclaration,
  scope: EntityID,
  changes: ScopeChanges,
): Promise<void> {
  for (const row of changes.writtenRows) {
    const table = consumer.tables[row.table];

    if (table !== undefined) {
      await writeRow(db, row.table, table, row.row);

      await db
        .replaceInto('scope_row')
        .values({ consumer: consumer.name, table_name: row.table, key: row.key, scope })
        .execute();
    }
  }

  for (const link of changes.writtenLinks) {
    await writeLink(db, consumer.name, scope, link);
  }

  for (const row of changes.deletedRows) {
    const table = consumer.tables[row.table];

    if (table !== undefined) {
      await removeRow(db, row.table, table, row.key);
    }

    await db
      .deleteFrom('scope_row')
      .where('consumer', '=', consumer.name)
      .where('table_name', '=', row.table)
      .where('key', '=', row.key)
      .execute();
  }

  for (const link of changes.deletedLinks) {
    await removeLink(db, consumer.name, link);
  }
}
