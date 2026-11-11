import type { ConsumerDeclaration } from '@pepys/kit';
import { replaceScope } from '../../scope-replace/replace-scope.ts';
import type { StoreDatabase } from '../../store-database/types.ts';
import { ApplyError } from '../../utils/apply-error.ts';
import type { ChangeEntry } from '../../utils/types.ts';

interface CaseScope {
  scope: string;
  output: string;
}

type CaseOutcome = { changes: ChangeEntry[] } | { refused: string };

// One batch of a scope replace case: each scope's replace in order, in one transaction. A refusal
// rolls the whole batch back, and the outcome names its kind as the case file does.
export async function runCaseBatch(
  db: StoreDatabase,
  consumer: ConsumerDeclaration,
  scopes: readonly CaseScope[],
): Promise<CaseOutcome> {
  try {
    const changes = await db.transaction().execute(async (transaction) => {
      const entries: ChangeEntry[] = [];

      for (const scope of scopes) {
        const replaced = await replaceScope(transaction, consumer, scope.scope, scope.output);

        entries.push(...replaced);
      }

      return entries;
    });

    return { changes };
  } catch (error) {
    if (error instanceof ApplyError) {
      return { refused: error.failure.kind };
    }

    throw error;
  }
}
