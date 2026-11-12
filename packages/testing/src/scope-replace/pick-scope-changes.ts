import type { Result } from '@pepys/kit';
import type { ApplyFailure, ChangeEntry, WireLink } from '../utils/types.ts';
import { buildLinkKey } from './build-link-key.ts';
import { buildRowID } from './build-row-id.ts';
import type { KeyedRow, ScopeChanges, ScopeResult, ScopeState } from './types.ts';

// The replace of one scope as a diff: write each returned row and link that is new or differs,
// delete each one the scope owned and did not return. Nothing may belong to another scope. The
// entries come as rows written, links written, rows deleted, links deleted, each in key order.
export function pickScopeChanges(
  consumer: string,
  scope: string,
  result: ScopeResult,
  state: ScopeState,
): Result<ScopeChanges, ApplyFailure> {
  const rows = result.rows.toSorted((left, right) =>
    compareKeys([left.table, left.key], [right.table, right.key]),
  );

  const links = result.links.toSorted((left, right) =>
    compareKeys([left.type, left.from, left.to], [right.type, right.from, right.to]),
  );

  const conflict = findConflict(consumer, scope, { rows, links }, state);

  if (conflict !== undefined) {
    return { ok: false, failure: conflict };
  }

  const writtenRows = rows.filter((row) => {
    const stored = state.storedRows.get(buildRowID(row.table, row.key));

    return stored === undefined || !Bun.deepEquals(stored, row.row);
  });

  const writtenLinks = links.filter((link) => {
    const stored = state.storedLinks.get(buildLinkKey(link));

    return stored === undefined || !isSameLink(stored.link, link);
  });

  const returned = new Set(rows.map((row) => buildRowID(row.table, row.key)));

  const deletedRows = [...state.rowOwners]
    .filter(([id, owner]) => owner === scope && !returned.has(id))
    .map(([id]) => toTableKey(id))
    .toSorted((left, right) => compareKeys([left.table, left.key], [right.table, right.key]));

  const returnedLinks = new Set(links.map((link) => buildLinkKey(link)));

  const deletedLinks = [...state.storedLinks]
    .filter(([key, stored]) => stored.scope === scope && !returnedLinks.has(key))
    .map(([, stored]) => stored.link)
    .toSorted((left, right) =>
      compareKeys([left.type, left.from, left.to], [right.type, right.from, right.to]),
    );

  const entries: ChangeEntry[] = [
    ...writtenRows.map((row) => buildRowEntry(row, state)),
    ...writtenLinks.map((link) => buildLinkEntry(link, state)),
    ...deletedRows.map((row) => ({
      type: row.table,
      key: row.key,
      old_value: state.storedRows.get(buildRowID(row.table, row.key)) ?? null,
      headers: { operation: 'delete' as const },
    })),
    ...deletedLinks.map((link) => ({
      type: 'link',
      key: buildLinkKey(link),
      headers: { operation: 'delete' as const },
    })),
  ];

  return { ok: true, value: { writtenRows, writtenLinks, deletedRows, deletedLinks, entries } };
}

// Plain `<` on the parts, never a locale order. It compares UTF-16 code units, and the host's Rust
// maps compare code points, so a key with text above U+FFFF can sort apart from the host's order.
function compareKeys(left: readonly string[], right: readonly string[]): number {
  for (const [index, part] of left.entries()) {
    const other = right[index] ?? '';

    if (part !== other) {
      return part < other ? -1 : 1;
    }
  }

  return left.length - right.length;
}

function findConflict(
  consumer: string,
  scope: string,
  result: ScopeResult,
  state: ScopeState,
): ApplyFailure | undefined {
  for (const row of result.rows) {
    const owner = state.rowOwners.get(buildRowID(row.table, row.key));

    if (owner !== undefined && owner !== scope) {
      return { kind: 'scope-conflict', consumer, scope, table: row.table, key: row.key, owner };
    }
  }

  for (const link of result.links) {
    const key = buildLinkKey(link);
    const stored = state.storedLinks.get(key);

    if (stored !== undefined && stored.scope !== scope) {
      return { kind: 'scope-conflict', consumer, scope, table: 'link', key, owner: stored.scope };
    }
  }

  return undefined;
}

// A confidence is a float on both sides, so `1` and `1.0` are one value.
function isSameLink(stored: WireLink, link: WireLink): boolean {
  return stored.confidence === link.confidence && stored.evidence === link.evidence;
}

function toTableKey(id: string): Omit<KeyedRow, 'row'> {
  const parsed: unknown = JSON.parse(id);
  const [table, key] = Array.isArray(parsed) ? parsed.map(String) : [];

  return { table: table ?? '', key: key ?? '' };
}

function buildRowEntry(row: KeyedRow, state: ScopeState): ChangeEntry {
  const old = state.storedRows.get(buildRowID(row.table, row.key));

  return old === undefined
    ? { type: row.table, key: row.key, value: row.row, headers: { operation: 'insert' } }
    : {
        type: row.table,
        key: row.key,
        value: row.row,
        old_value: old,
        headers: { operation: 'update' },
      };
}

function buildLinkEntry(link: WireLink, state: ScopeState): ChangeEntry {
  const key = buildLinkKey(link);
  const old = state.storedLinks.get(key);
  const value = toLinkValue(link);

  return old === undefined
    ? { type: 'link', key, value, headers: { operation: 'insert' } }
    : {
        type: 'link',
        key,
        value,
        old_value: toLinkValue(old.link),
        headers: { operation: 'update' },
      };
}

function toLinkValue(link: WireLink): WireLink {
  return {
    type: link.type,
    from: link.from,
    to: link.to,
    confidence: link.confidence,
    evidence: link.evidence,
  };
}
