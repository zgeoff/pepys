import type { Kysely } from 'kysely';
import type { Simplify, UnionToIntersection } from 'type-fest';
import type { z } from 'zod';
import type { ConsumerDeclaration } from '../consumers/types.ts';
import type { ConsumersDB } from '../store-reader/store-reader.ts';
import type { TableRow } from '../tables/table-row.ts';

// The Kysely tables of a set of consumers, from their declarations. No consumers give `unknown`,
// which adds no table to an intersection, where the intersection of an empty union would give
// `never`.
export type StoreTables<Consumers extends readonly ConsumerDeclaration[]> =
  Consumers extends readonly []
    ? unknown
    : Simplify<
        UnionToIntersection<
          {
            [Index in keyof Consumers]: {
              -readonly [Table in keyof Consumers[Index]['tables']]: TableRow<
                Consumers[Index]['tables'][Table]
              >;
            };
          }[number]
        >
      >;

export interface QueryCall<Input, Consumers extends readonly ConsumerDeclaration[]> {
  input: Input;

  // One read-only connection with the current file of each consumer in `reads` attached, and the
  // `entity` and `link_effective` views over those files.
  db: Kysely<ConsumersDB<Consumers>>;
}

// Generic over the schemas, not their types: `z.ZodType<Input>` keeps the parsed type alone, and a
// client needs the type a schema takes in.
export interface QueryDefinition<
  Name extends string = string,
  InputSchema extends z.ZodType = z.ZodType,
  OutputSchema extends z.ZodType = z.ZodType,
  Consumers extends readonly ConsumerDeclaration[] = readonly ConsumerDeclaration[],
> {
  // snake case: the procedure key and the MCP tool name
  readonly name: Name;

  // the text an MCP agent reads
  readonly description: string;

  // plain zod objects with no transform, because the MCP schemas come from them
  readonly input: InputSchema;
  readonly output: OutputSchema;
  readonly reads: Consumers;
  readonly handler: (
    call: QueryCall<z.output<InputSchema>, Consumers>,
  ) => Promise<z.input<OutputSchema>>;
}

// Any query, as a list of a plug-in's queries holds it. A handler takes its own call type, so no
// one call type fits every handler.
export type AnyQueryDefinition = Omit<QueryDefinition, 'handler'> & {
  readonly handler: (call: never) => Promise<unknown>;
};
