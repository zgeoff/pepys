import { findLinkProblem } from '@pepys/kit';
import type { ConsumerDeclaration, Result } from '@pepys/kit';
import type { Operation } from '../operations/types.ts';
import { buildRowKey } from '../rows/build-row-key.ts';
import { findRowProblem } from '../rows/find-row-problem.ts';
import type { ApplyFailure, WireLink } from '../utils/types.ts';
import { buildLinkKey } from './build-link-key.ts';
import { buildRowID } from './build-row-id.ts';
import type { KeyedRow, ScopeResult } from './types.ts';

// The host's checks of one scope's operations, in its order: no delete or unlink, every link, then
// each row and its key, then each link key.
export function collectScopeResult(
  consumer: ConsumerDeclaration,
  operations: readonly Operation[],
): Result<ScopeResult, ApplyFailure> {
  const name = consumer.name;
  const upserts: (Operation & { verb: 'upsert' })[] = [];
  const links: WireLink[] = [];

  for (const operation of operations) {
    if (operation.verb === 'delete' || operation.verb === 'unlink') {
      const reason = `a scope consumer returned ${operation.verb === 'delete' ? 'a delete' : 'an unlink'}`;

      return { ok: false, failure: { kind: 'bad-operation', consumer: name, reason } };
    }

    if (operation.verb === 'link') {
      links.push(operation.link);
    } else {
      upserts.push(operation);
    }
  }

  for (const link of links) {
    const problem = findLinkProblem(consumer, link);

    if (problem !== undefined) {
      return { ok: false, failure: { kind: 'bad-link', consumer: name, problem } };
    }
  }

  const rows = new Map<string, KeyedRow>();

  for (const upsert of upserts) {
    const table = consumer.tables[upsert.table];

    if (table === undefined) {
      return { ok: false, failure: { kind: 'not-owned', consumer: name, table: upsert.table } };
    }

    const reason = findRowProblem(table, upsert.row, upsert.inexact);

    if (reason !== undefined) {
      return {
        ok: false,
        failure: { kind: 'bad-row', consumer: name, table: upsert.table, reason },
      };
    }

    const key = buildRowKey(table, upsert.row);
    const id = buildRowID(upsert.table, key);

    if (rows.has(id)) {
      return {
        ok: false,
        failure: { kind: 'duplicate-row', consumer: name, table: upsert.table, key },
      };
    }

    rows.set(id, { table: upsert.table, key, row: upsert.row });
  }

  const keyed = new Map<string, WireLink>();

  for (const link of links) {
    const key = buildLinkKey(link);

    if (keyed.has(key)) {
      return { ok: false, failure: { kind: 'duplicate-link', consumer: name, key } };
    }

    keyed.set(key, link);
  }

  return { ok: true, value: { rows: [...rows.values()], links: [...keyed.values()] } };
}
