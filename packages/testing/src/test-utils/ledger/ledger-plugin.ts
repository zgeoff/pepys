import {
  defineConsumer,
  defineFactFamily,
  defineLinkType,
  definePlugin,
  defineSource,
  defineTable,
  receiveFactBatch,
} from '@pepys/kit';
import { z } from 'zod';

const postedEntrySchema = z.object({
  entry: z.string(),
  amount: z.number().int(),
  rate: z.number(),
  memo: z.string(),
  details: z.record(z.string(), z.string()),
});

const accountFamily = defineFactFamily({
  stream: 'facts.ledger.account',
  api: 'ledger/1',
  entityKind: 'ledger:account',
  types: {
    'ledger.account.opened': z.object({ name: z.string() }),
    'ledger.account.renamed': z.object({ name: z.string() }),
    'ledger.account.closed': z.object({}),
    'ledger.entry.posted': postedEntrySchema,
  },
});

export const ledgerSource = defineSource({
  name: 'ledger',
  families: [accountFamily],
  live: receiveFactBatch({
    route: '/ledger/facts',
    check: { kind: 'hmac-sha256', header: 'x-ledger-signature-256', secretEnv: 'LEDGER_SECRET' },
  }),
});

const entryOf = defineLinkType({
  name: 'entry_of',
  from: ['ledger:entry'],
  to: ['ledger:account'],
  hub: false,
});

// A stub scope consumer: one account is one scope, with its row, one row per entry, and a link from
// each entry to the account.
export const ledgerAccountConsumer = defineConsumer({
  name: 'ledger_account',
  entry: new URL('consumers/ledger-account.ts', import.meta.url),
  input: { mode: 'scope', scopeKind: 'ledger:account', streams: [accountFamily.stream] },
  tables: {
    ledger_account: defineTable({
      columns: {
        id: { kind: 'entityID' },
        name: { kind: 'text', nullable: true },
        balance: { kind: 'integer' },
        is_closed: { kind: 'boolean' },
        opened_at: { kind: 'timestamp', nullable: true },
        updated_at: { kind: 'timestamp' },
      },
      primaryKey: ['id'],
      indexes: [],
    }),
    ledger_entry: defineTable({
      columns: {
        id: { kind: 'entityID' },
        account_id: { kind: 'entityID' },
        amount: { kind: 'integer' },
        rate: { kind: 'real' },
        memo: { kind: 'text' },
        details: { kind: 'json' },
        posted_at: { kind: 'timestamp' },
      },
      primaryKey: ['id'],
      indexes: [{ columns: ['account_id'] }],
    }),
  },
  entityViews: [
    {
      table: 'ledger_account',
      kind: 'ledger:account',
      id: 'id',
      title: 'name',
      url: null,
      actor: null,
      updatedAt: 'updated_at',
    },
    {
      table: 'ledger_entry',
      kind: 'ledger:entry',
      id: 'id',
      title: 'memo',
      url: null,
      actor: null,
      updatedAt: 'posted_at',
    },
  ],
  reads: [],
  links: [entryOf],
});

export const ledgerPlugin = definePlugin({
  name: 'ledger',
  sources: [ledgerSource],
  consumers: [ledgerAccountConsumer],
});
