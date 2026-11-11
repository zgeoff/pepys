import type { z } from 'zod';
import type { EntityKind } from '../link-types/types.ts';
import type { FactFamily } from './types.ts';

export function defineFactFamily<
  const Types extends Readonly<Record<string, z.ZodType>>,
  const Kind extends EntityKind,
>(family: FactFamily<Types, Kind>): FactFamily<Types, Kind> {
  return family;
}
