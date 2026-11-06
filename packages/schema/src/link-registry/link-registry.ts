import type { ClientID, EntityID, FactID, Reference } from '../ids/ids.ts';

export type EntityKind = `${string}:${string}`;

// A plain string key, not a symbol: scriptc refuses the type-fest import that a symbol brand
// needs, and the brand a consumer generates must have the same shape.
export type KindedID<Kind extends EntityKind> = EntityID & { readonly '~entityKind': Kind };

export interface LinkTypeDeclaration<
  Name extends string = string,
  From extends EntityKind = EntityKind,
  To extends EntityKind = EntityKind,
> {
  readonly name: Name;
  readonly from: readonly From[];
  readonly to: readonly To[];
  readonly hub: boolean;
}

export type LinkRegistry = Readonly<
  Record<string, { readonly from: readonly EntityKind[]; readonly to: readonly EntityKind[] }>
>;

export type LinkRegistryOf<Declaration extends LinkTypeDeclaration> = {
  readonly [Entry in Declaration as Entry['name']]: {
    readonly from: Entry['from'];
    readonly to: Entry['to'];
  };
};

export type LinkTypeName<Registry extends LinkRegistry> = keyof Registry & string;

export type LinkTypeSources<
  Registry extends LinkRegistry,
  Name extends LinkTypeName<Registry>,
> = Registry[Name]['from'][number];

export type LinkTypeTargets<
  Registry extends LinkRegistry,
  Name extends LinkTypeName<Registry>,
> = Registry[Name]['to'][number];

export type LinkTarget<To extends EntityKind> =
  | { kind: 'entity'; id: KindedID<To> }
  | { kind: 'reference'; reference: Reference };

export type LinkOrigin =
  | { kind: 'consumer'; name: string }
  | { kind: 'manual'; client: ClientID; fact: FactID };

// A mapped union, not one object type: `Omit` over a union of link types loses the pairing of each
// type name with the kinds it allows.
export type LinkEnds<Registry extends LinkRegistry> = {
  [Name in LinkTypeName<Registry>]: {
    type: Name;
    from: KindedID<LinkTypeSources<Registry, Name>>;
    to: LinkTarget<LinkTypeTargets<Registry, Name>>;
  };
}[LinkTypeName<Registry>];

export interface LinkDetails {
  scope: string | null;
  confidence: number;
  evidence: string;
}

export type Link<Registry extends LinkRegistry> = LinkEnds<Registry> & LinkDetails;

export type EffectiveLink<Registry extends LinkRegistry> = Link<Registry> & { origin: LinkOrigin };

export type LinkRetraction<Registry extends LinkRegistry> = LinkEnds<Registry>;
