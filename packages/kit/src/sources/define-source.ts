import type { FactFamily, SourceDefinition } from './types.ts';

export function defineSource<const Family extends FactFamily>(
  source: SourceDefinition<Family>,
): SourceDefinition<Family> {
  return source;
}
