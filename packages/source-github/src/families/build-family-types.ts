import type { z } from 'zod';

export function buildFamilyTypes(
  family: string,
  actions: readonly string[],
  schema: z.ZodType,
): Readonly<Record<string, z.ZodType>> {
  const types: Record<string, z.ZodType> = {};

  for (const action of actions) {
    types[`github.${family}.${action}`] = schema;
  }

  return types;
}
