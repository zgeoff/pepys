// `<source>:<kind>`, in an entity view, a link end, a scope kind and an entity ID alike.
export type EntityKind = `${string}:${string}`;

export interface LinkTypeDeclaration<
  Name extends string = string,
  From extends EntityKind = EntityKind,
  To extends EntityKind = EntityKind,
> {
  readonly name: Name;
  readonly from: readonly From[];
  readonly to: readonly To[];

  // `neighbourhood` follows a hub link type only when the caller asks
  readonly hub: boolean;
}
