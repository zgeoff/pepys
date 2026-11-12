import { buildGrantSeeder } from './build-grant-seeder.ts';
import { buildPasskeySeeder } from './build-passkey-seeder.ts';
import type { MCPAuthSeedDeps } from './types.ts';

export type TestDeps = MCPAuthSeedDeps;

export function buildSeeder(deps: TestDeps) {
  return { ...buildPasskeySeeder(deps), ...buildGrantSeeder(deps) };
}
