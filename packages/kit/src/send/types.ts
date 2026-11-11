import type { z } from 'zod';
import type { FactBatchBody, SourceDefinition } from '../sources/types.ts';

// One fact of a batch, typed by the families of the source: the type picks the payload schema, and
// the entity has the family's kind. It is a fact of the wire body whatever the source.
export type OutgoingFact<Source extends SourceDefinition> = FactBatchBody['facts'][number] &
  {
    [Family in Source['families'][number] as Family['stream']]: {
      [Type in keyof Family['types'] & string]: {
        type: Type;
        event: string;
        entity: `${Family['entityKind']}:${string}`;
        actor?: string | undefined;
        at: string;
        payload: z.input<Family['types'][Type]>;
      };
    }[keyof Family['types'] & string];
  }[Source['families'][number]['stream']];

// Every 5xx is a `retry`: ingest answers 500 when the log refuses an append for a fault of the
// deployment, and part of the batch may be stored by then. A sender that dropped the batch as
// refused would lose the rest.
export type SendFailure =
  | { kind: 'refused'; status: number; reason: string }
  | { kind: 'retry'; reason: string };
