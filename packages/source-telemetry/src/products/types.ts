import type { LogRecord } from '../otlp/types.ts';

// The ingest half of a product. It holds no row shape.
export interface TelemetryProduct<Name extends string = string, Event extends string = string> {
  // the `product` column, and the middle part of every fact type
  readonly name: Name;

  // the short event name when the record is this product's; the first product that answers owns it
  readonly readEvent: (record: LogRecord) => string | undefined;

  // the attribute that holds the agent's own session ID
  readonly agentSessionAttribute: string;

  // the attribute that holds the time the product wrote; `timeUnixNano` when it is absent
  readonly timeAttribute: string;

  // the attribute that numbers the events of one agent session; null when the product writes none
  readonly sequenceAttribute: string | null;

  // the events with a fact type of their own; `key` gives the event's own key for the fact ID
  readonly events: Readonly<
    Record<Event, { readonly key?: ((record: LogRecord) => string | undefined) | undefined }>
  >;
}
