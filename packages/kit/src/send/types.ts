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

// A 502, 503 or 504 answer, a timeout and no connection are a `retry`: send the same batch again,
// unchanged. Every other answer that is no success is `refused`, 500 included: ingest answers 500
// for a batch that no resend of the same bytes can store.
export type SendFailure =
  | { kind: 'refused'; status: number; reason: string }
  | { kind: 'retry'; reason: string };
