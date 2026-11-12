import {
  initLedgerAccountModel,
  linkEntryOf,
  parseLedgerAccountID,
  readScopeFacts,
  toLedgerEntryID,
  updateLedgerAccountModel,
} from '../generated/ledger-account-boundary.ts';
import type {
  FactID,
  LedgerAccountFact,
  LedgerAccountID,
  LedgerAccountMessage,
  LedgerAccountModel,
  LedgerAccountOperation,
  LedgerEntryRow,
} from '../generated/ledger-account-boundary.ts';

export type {
  LedgerAccountMessage,
  LedgerAccountModel,
} from '../generated/ledger-account-boundary.ts';

// scriptc takes the model and message types through a re-export, but not the two functions
export function init(): LedgerAccountModel {
  return initLedgerAccountModel();
}

export function update(
  model: LedgerAccountModel,
  message: LedgerAccountMessage,
): LedgerAccountModel {
  return updateLedgerAccountModel(model, message);
}

export function applyScope(scope: string): string {
  const account = parseLedgerAccountID(scope);

  if (account === undefined) {
    return JSON.stringify([]);
  }

  return JSON.stringify(mapAccount(account, readScopeFacts(account)));
}

interface Named {
  name: string;
  at: string;
  factID: FactID;
}

interface PostedEntry {
  row: LedgerEntryRow;
  factID: FactID;
}

function mapAccount(
  account: LedgerAccountID,
  facts: readonly LedgerAccountFact[],
): LedgerAccountOperation[] {
  let named: Named | undefined;
  let isClosed = false;
  let openedAt: string | null = null;
  let updatedAt = '';
  const entries: PostedEntry[] = [];

  for (const fact of facts) {
    if (fact.at > updatedAt) {
      updatedAt = fact.at;
    }

    if (fact.type === 'ledger.entry.posted') {
      postEntry(entries, account, fact);
    } else if (fact.type === 'ledger.account.closed') {
      isClosed = true;
    } else {
      if (fact.type === 'ledger.account.opened' && (openedAt === null || fact.at < openedAt)) {
        openedAt = fact.at;
      }

      if (named === undefined || isNewer(fact.at, fact.id, named.at, named.factID)) {
        named = { name: fact.payload.name, at: fact.at, factID: fact.id };
      }
    }
  }

  if (updatedAt === '') {
    return [];
  }

  return buildOperations(account, { named, isClosed, openedAt, updatedAt, entries });
}

// Two facts may share one time, so the larger fact ID wins a tie, in every arrival order.
function isNewer(at: string, factID: FactID, otherAt: string, otherFactID: FactID): boolean {
  return at > otherAt || (at === otherAt && factID > otherFactID);
}

function postEntry(
  entries: PostedEntry[],
  account: LedgerAccountID,
  fact: Extract<LedgerAccountFact, { type: 'ledger.entry.posted' }>,
): void {
  const posted: PostedEntry = {
    row: {
      id: toLedgerEntryID(fact.payload.entry),
      account_id: account,
      amount: fact.payload.amount,
      rate: fact.payload.rate,
      memo: fact.payload.memo,
      details: fact.payload.details,
      posted_at: fact.at,
    },
    factID: fact.id,
  };

  for (let index = 0; index < entries.length; index += 1) {
    const stored = entries[index];

    if (stored !== undefined && stored.row.id === posted.row.id) {
      if (isNewer(fact.at, fact.id, stored.row.posted_at, stored.factID)) {
        entries[index] = posted;
      }

      return;
    }
  }

  entries.push(posted);
}

interface AccountState {
  named: Named | undefined;
  isClosed: boolean;
  openedAt: string | null;
  updatedAt: string;
  entries: readonly PostedEntry[];
}

function buildOperations(account: LedgerAccountID, state: AccountState): LedgerAccountOperation[] {
  let balance = 0;
  const operations: LedgerAccountOperation[] = [];

  for (const entry of state.entries) {
    balance += entry.row.amount;

    operations.push(
      { upsert: { ledger_entry: entry.row } },
      linkEntryOf({ from: entry.row.id, to: account, confidence: 1, evidence: entry.factID }),
    );
  }

  operations.unshift({
    upsert: {
      ledger_account: {
        id: account,
        name: state.named === undefined ? null : state.named.name,
        balance,
        is_closed: state.isClosed,
        opened_at: state.openedAt,
        updated_at: state.updatedAt,
      },
    },
  });

  return operations;
}
