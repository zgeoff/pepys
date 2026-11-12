import { P, match } from 'ts-pattern';
import { z } from 'zod';

// The paths of the coerced strings, numbers and booleans in a payload schema, at any depth. Ingest
// stores a payload as sent, so a consumer reads the value before coercion, which is not the type
// the schema promises.
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
    .with(P.instanceOf(z.ZodTuple), (tuple) => {
      const items = tuple.def.items.flatMap((item, index) =>
        collectCoercedFields(item, `${path}[${index}]`),
      );

      const rest = tuple.def.rest === null ? [] : collectCoercedFields(tuple.def.rest, `${path}[]`);

      return [...items, ...rest];
    })
    .with(P.instanceOf(z.ZodRecord), (record) =>
      collectCoercedFields(record.def.valueType, `${path}.*`),
    )
    .with(P.instanceOf(z.ZodUnion), (union) =>
      union.def.options.flatMap((option) => collectCoercedFields(option, path)),
    )
    .with(P.instanceOf(z.ZodIntersection), (intersection) => [
      ...collectCoercedFields(intersection.def.left, path),
      ...collectCoercedFields(intersection.def.right, path),
    ])
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
