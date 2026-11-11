import { findLinkProblem } from '@pepys/kit';
import type { ConsumerDeclaration, TableDeclaration } from '@pepys/kit';
import invariant from 'tiny-invariant';
import { match } from 'ts-pattern';
import { removeLink } from '../links/remove-link.ts';
import { writeLink } from '../links/write-link.ts';
import type { Operation } from '../operations/types.ts';
import { buildRowKey } from '../rows/build-row-key.ts';
import { findRowProblem } from '../rows/find-row-problem.ts';
import { removeRow } from '../rows/remove-row.ts';
import { writeRow } from '../rows/write-row.ts';
import type { StoreDatabase } from '../store-database/types.ts';
import { ApplyError } from '../utils/apply-error.ts';

// The operations of one fact, in fact mode: every check first, then the writes in order. A link
// has no scope.
export async function applyFactOperations(
  db: StoreDatabase,
  consumer: ConsumerDeclaration,
  operations: readonly Operation[],
): Promise<void> {
  for (const operation of operations) {
    if (operation.verb === 'link') {
      const problem = findLinkProblem(consumer, operation.link);

      if (problem !== undefined) {
        throw new ApplyError({ kind: 'bad-link', consumer: consumer.name, problem });
      }
    }

    if (operation.verb === 'upsert') {
      const reason = findRowProblem(
        getTable(consumer, operation.table),
        operation.row,
        operation.inexact,
      );

      if (reason !== undefined) {
        throw new ApplyError({
          kind: 'bad-row',
          consumer: consumer.name,
          table: operation.table,
          reason,
        });
      }
    }
  }

  for (const operation of operations) {
    await match(operation)
      .with({ verb: 'upsert' }, (upsert) =>
        writeRow(db, upsert.table, getTable(consumer, upsert.table), upsert.row),
      )
      .with({ verb: 'delete' }, (removal) => {
        const table = getTable(consumer, removal.table);

        return removeRow(db, removal.table, table, buildRowKey(table, removal.key));
      })
      .with({ verb: 'link' }, (linking) => writeLink(db, consumer.name, null, linking.link))
      .with({ verb: 'unlink' }, (unlinking) => removeLink(db, consumer.name, unlinking.link))
      .exhaustive();
  }
}

function getTable(consumer: ConsumerDeclaration, name: string): TableDeclaration {
  const table = consumer.tables[name];

  invariant(table, 'the parse of the operations refuses a table the consumer does not own');

  return table;
}
