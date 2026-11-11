import type {
  ConsumerDeclaration,
  LinkRow,
  OutgoingFact,
  QueryDefinition,
  Sender,
  SourceDefinition,
  TableRow,
} from '@pepys/kit';
import type { z } from 'zod';
import type { MemoryStoreReader } from '../memory-store-reader/create-memory-store-reader.ts';
import type { Row } from '../utils/types.ts';

type WithOptionalOrigin<Payload> = Payload extends { origin: infer Origin }
  ? Omit<Payload, 'origin'> & { origin?: Origin }
  : Payload;

// A fact as a sender writes it in a fact batch. With a `sender` on the apply, the payload's
// `origin` may be left out: the store writes it, as a source's read does for a proven sender.
export type AppliedFact<Source extends SourceDefinition> =
  OutgoingFact<Source> extends infer Fact
    ? Fact extends { payload: infer Payload }
      ? Omit<Fact, 'payload'> & { payload: WithOptionalOrigin<Payload> }
      : never
    : never;

export interface ApplyOptions {
  // the proven sender of the batch; the store copies it into each payload as `origin`
  sender?: Pick<Sender, 'issuer' | 'subject'> | undefined;
}

export interface TestStore extends AsyncDisposable {
  // Writes rows as they are, with no scope, for a test of a query.
  writeRows: <
    Consumer extends ConsumerDeclaration,
    Table extends keyof Consumer['tables'] & string,
  >(
    consumer: Consumer,
    table: Table,
    rows: readonly TableRow<Consumer['tables'][Table]>[],
  ) => Promise<void>;

  // Builds the envelopes as a fact batch path does, with `event:` IDs, parses each with the
  // envelope parser, and runs each consumer whose input names the fact's stream. A refusal throws
  // an ApplyError, and the batch then writes nothing.
  apply: <Source extends SourceDefinition>(
    source: Source,
    facts: readonly AppliedFact<Source>[],
    options?: ApplyOptions,
  ) => Promise<void>;

  query: <
    InputSchema extends z.ZodType,
    OutputSchema extends z.ZodType,
    Consumers extends readonly ConsumerDeclaration[],
  >(
    query: QueryDefinition<string, InputSchema, OutputSchema, Consumers>,
    input: z.input<InputSchema>,
  ) => Promise<z.output<OutputSchema>>;

  // every link, in key order
  readLinks: () => Promise<readonly LinkRow[]>;

  // every row of one table in primary key order, as the module wrote it
  readRows: (table: string) => Promise<readonly Row[]>;

  reader: MemoryStoreReader;
}
