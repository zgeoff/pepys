import { P, match } from 'ts-pattern';
import { z } from 'zod';

// What the glue makes of a payload schema. The log keeps a payload as the sender sent it, so the
// shape follows the input side of the schema: a field with a default may be absent.
export type PayloadShape =
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'literal'; values: readonly (string | number | boolean)[] }
  | { kind: 'object'; fields: readonly PayloadField[] }
  | { kind: 'array'; element: PayloadShape }
  | { kind: 'nullable'; inner: PayloadShape }
  | { kind: 'unknown' };

export function buildPayloadShape(schema: z.core.$ZodType): PayloadShape {
  // A string format, such as `z.uuid()`, is no ZodString in zod 4, but shares the core class.
  return match(schema)
    .with(P.instanceOf(z.core.$ZodString), () => ({ kind: 'string' as const }))
    .with(P.instanceOf(z.ZodNumber), () => ({ kind: 'number' as const }))
    .with(P.instanceOf(z.ZodBoolean), () => ({ kind: 'boolean' as const }))
    .with(P.instanceOf(z.ZodLiteral), (literal) => buildLiteralShape([...literal.def.values]))
    .with(P.instanceOf(z.ZodEnum), (enumeration) =>
      buildLiteralShape(Object.values(enumeration.def.entries)),
    )
    .with(P.instanceOf(z.ZodObject), (object) => ({
      kind: 'object' as const,
      fields: Object.entries<z.core.$ZodType>(object.shape).map(([name, field]) =>
        buildPayloadField(name, field),
      ),
    }))
    .with(P.instanceOf(z.ZodArray), (array) => ({
      kind: 'array' as const,
      element: buildPayloadShape(array.element),
    }))
    .with(P.instanceOf(z.ZodNullable), (nullable) => buildNullableShape(nullable.unwrap()))
    .otherwise(() => ({ kind: 'unknown' as const }));
}

function buildLiteralShape(values: readonly unknown[]): PayloadShape {
  const literals = values.filter(
    (value) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean',
  );

  return literals.length === values.length && literals.length > 0
    ? { kind: 'literal', values: literals }
    : { kind: 'unknown' };
}

export interface PayloadField {
  name: string;
  shape: PayloadShape;
  isOptional: boolean;
}

function buildPayloadField(name: string, schema: z.core.$ZodType): PayloadField {
  return match(schema)
    .with(P.instanceOf(z.ZodOptional), (optional) => ({
      name,
      shape: buildPayloadShape(optional.unwrap()),
      isOptional: true,
    }))
    .with(P.instanceOf(z.ZodDefault), (withDefault) => ({
      name,
      shape: buildPayloadShape(withDefault.unwrap()),
      isOptional: true,
    }))
    .otherwise(() => ({ name, shape: buildPayloadShape(schema), isOptional: false }));
}

function buildNullableShape(schema: z.core.$ZodType): PayloadShape {
  const inner = buildPayloadShape(schema);

  return inner.kind === 'unknown' ? inner : { kind: 'nullable', inner };
}
