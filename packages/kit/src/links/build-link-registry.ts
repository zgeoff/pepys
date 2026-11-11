import type { LinkTypeDeclaration } from '../link-types/types.ts';
import type { LinkRegistry } from './types.ts';

// The deployment check refuses one name with two shapes, so a name maps to one declaration.
export function buildLinkRegistry(linkTypes: readonly LinkTypeDeclaration[]): LinkRegistry {
  return new Map(linkTypes.map((linkType) => [linkType.name, linkType]));
}
