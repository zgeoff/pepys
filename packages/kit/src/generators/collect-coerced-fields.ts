import { P, match } from 'ts-pattern';
import { z } from 'zod';

// The paths of the coerced strings, numbers and booleans that the glue's decoder checks. Ingest
// stores a payload as sent, so the decoder sees the value before coercion and refuses it. The walk
// takes the steps that buildPayloadShape takes; any other schema decodes as `unknown`.
export function collectCoercedFields(schema: z.core.$ZodType, path: string): string[] {
  return match(schema)
    .with(
      P.union(P.instanceOf(z.ZodString), P.instanceOf(z.ZodNumber), P.instanceOf(z.ZodBoolean)),
      (scalar) => (scalar.def.coerce === true ? [path] : []),
    )
    .with(P.instanceOf(z.ZodObject), (object) =>
      Object.entries<z.core.$ZodType>(object.shape).flatMap(([name, field]) => {
        const fieldPath = path === '' ? name : `${path}.${name}`;

        return collectCoercedFields(field, fieldPath);
      }),
    )
    .with(P.instanceOf(z.ZodArray), (array) => collectCoercedFields(array.element, `${path}[]`))
    .with(
      P.union(
        P.instanceOf(z.ZodNullable),
        P.instanceOf(z.ZodOptional),
        P.instanceOf(z.ZodExactOptional),
        P.instanceOf(z.ZodDefault),
      ),
      (wrapper) => collectCoercedFields(wrapper.unwrap(), path),
    )
    .otherwise(() => []);
}
