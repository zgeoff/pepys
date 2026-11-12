import { seedGrantID } from './seed-grant-id.ts';
import type { GrantIDInput } from './seed-grant-id.ts';
import type { MCPAuthSeedDeps } from './types.ts';

export function buildGrantSeeder(deps: Pick<MCPAuthSeedDeps, 'db'>) {
  return {
    grantID: (input: GrantIDInput) => seedGrantID(deps, input),
  };
}
