import type { ConsumerDeclaration, EntityID } from '@pepys/kit';
import { parseOperations } from '../operations/parse-operations.ts';
import type { StoreDatabase } from '../store-database/types.ts';
import { ApplyError } from '../utils/apply-error.ts';
import type { ChangeEntry } from '../utils/types.ts';
import { collectScopeResult } from './collect-scope-result.ts';
import { pickScopeChanges } from './pick-scope-changes.ts';
import { readScopeState } from './read-scope-state.ts';
import { writeScopeChanges } from './write-scope-changes.ts';

// The host's scope replace of one scope, from the module's output text, inside the caller's
// transaction. It throws an ApplyError on a refusal, and the caller rolls the batch back.
export async function replaceScope(
  db: StoreDatabase,
  consumer: ConsumerDeclaration,
  scope: EntityID,
  output: string,
): Promise<readonly ChangeEntry[]> {
  const operations = parseOperations(consumer, output);

  if (!operations.ok) {
    throw new ApplyError(operations.failure);
  }

  const result = collectScopeResult(consumer, operations.value);

  if (!result.ok) {
    throw new ApplyError(result.failure);
  }

  const state = await readScopeState(db, consumer, scope, result.value);

  const changes = pickScopeChanges(consumer.name, scope, result.value, state);

  if (!changes.ok) {
    throw new ApplyError(changes.failure);
  }

  await writeScopeChanges(db, consumer, scope, changes.value);

  return changes.value.entries;
}
