import type { z } from 'zod';

// One fact type per action, `github.<family>.<action>`, each with the family's payload schema.
export function buildFamilyTypes(
  family: string,
  actions: readonly string[],
  schema: z.ZodType,
): Readonly<Record<string, z.ZodType>> {
  return Object.fromEntries(actions.map((action) => [`github.${family}.${action}`, schema]));
}
