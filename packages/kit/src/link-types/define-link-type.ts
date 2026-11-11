import type { EntityKind, LinkTypeDeclaration } from './types.ts';

export function defineLinkType<
  const Name extends string,
  const From extends EntityKind,
  const To extends EntityKind,
>(linkType: LinkTypeDeclaration<Name, From, To>): LinkTypeDeclaration<Name, From, To> {
  return linkType;
}
