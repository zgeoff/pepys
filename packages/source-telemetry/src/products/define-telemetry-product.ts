import type { TelemetryProduct } from './types.ts';

export function defineTelemetryProduct<const Name extends string, const Event extends string>(
  product: TelemetryProduct<Name, Event>,
): TelemetryProduct<Name, Event> {
  return product;
}
