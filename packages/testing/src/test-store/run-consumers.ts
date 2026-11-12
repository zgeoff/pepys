import type { ConsumerDeclaration, FactID } from '@pepys/kit';
import invariant from 'tiny-invariant';
import { buildReadFunctions } from '../consumer-entries/build-read-functions.ts';
import { runEntry } from '../consumer-entries/run-entry.ts';
import { collectScopeFacts } from '../fact-index/collect-scope-facts.ts';
import type { FactIndex, LoggedFact } from '../fact-index/types.ts';
import { applyFactOperations } from '../fact-mode/apply-fact-operations.ts';
import { readRowFunctions } from '../fact-mode/read-row-functions.ts';
import { parseOperations } from '../operations/parse-operations.ts';
import { replaceScope } from '../scope-replace/replace-scope.ts';
import type { StoreDatabase } from '../store-database/types.ts';
import { ApplyError } from '../utils/apply-error.ts';
import { collectDirtyScopes } from './collect-dirty-scopes.ts';
import { collectNewFacts } from './collect-new-facts.ts';

// The fact IDs each fact-mode consumer has applied, by consumer name.
export type AppliedFactIDs = ReadonlyMap<string, ReadonlySet<FactID>>;

interface ConsumerRun {
  index: FactIndex;
  appended: readonly LoggedFact[];
  applied: AppliedFactIDs;
}

// Runs every consumer on one appended batch, in deployment order, inside the caller's transaction,
// and returns the applied fact IDs after it.
export async function runConsumers(
  db: StoreDatabase,
  consumers: readonly ConsumerDeclaration[],
  run: ConsumerRun,
): Promise<AppliedFactIDs> {
  const applied = new Map(run.applied);

  for (const consumer of consumers) {
    const facts = run.appended.filter((record) =>
      consumer.input.streams.some((stream) => stream === record.stream),
    );

    if (consumer.input.mode === 'fact') {
      const seen = await runFactConsumer(
        db,
        consumer,
        facts,
        run.applied.get(consumer.name) ?? new Set(),
      );

      applied.set(consumer.name, seen);
    } else {
      await runScopeConsumer(db, consumer, facts, run.index);
    }
  }

  return applied;
}

async function runFactConsumer(
  db: StoreDatabase,
  consumer: ConsumerDeclaration,
  facts: readonly LoggedFact[],
  applied: ReadonlySet<FactID>,
): Promise<ReadonlySet<FactID>> {
  for (const record of collectNewFacts(facts, applied)) {
    const host = await readRowFunctions(db, consumer);
    const output = await runEntry(consumer, 'applyFact', JSON.stringify(record.envelope), host);

    const operations = parseOperations(consumer, output);

    if (!operations.ok) {
      throw new ApplyError(operations.failure);
    }

    await applyFactOperations(db, consumer, operations.value);
  }

  return new Set([...applied, ...facts.map((record) => record.envelope.id)]);
}

async function runScopeConsumer(
  db: StoreDatabase,
  consumer: ConsumerDeclaration,
  facts: readonly LoggedFact[],
  index: FactIndex,
): Promise<void> {
  invariant(consumer.input.mode === 'scope', 'only a scope consumer has a scope kind');

  for (const scope of collectDirtyScopes(facts, consumer.input.scopeKind)) {
    const scopeFacts = JSON.stringify(collectScopeFacts(index, scope, consumer.input.streams));
    const host = buildReadFunctions('readScopeFacts', new Map([[scope, scopeFacts]]), 'trap');

    const output = await runEntry(consumer, 'applyScope', scope, host);

    await replaceScope(db, consumer, scope, output);
  }
}
