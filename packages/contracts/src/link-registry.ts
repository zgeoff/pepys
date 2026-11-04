import type { ClientID, EntityID, FactID, Reference } from './ids.ts';

// An entity kind is the first two parts of its IDs, such as `github:pr` or `gmail:msg`.
export type EntityKind = `${string}:${string}`;

// The brand is a plain string key, so the local brand that a scriptc consumer generates has the
// same shape; scriptc refuses the type-fest import that a symbol brand would need.
export type KindedID<Kind extends EntityKind> = EntityID & { readonly '~entityKind': Kind };

// The one way a plain ID from the API or a query becomes kinded, so no caller needs an assertion.
export type IsEntityOfKind = <Kind extends EntityKind>(
  id: EntityID,
  kinds: readonly Kind[],
) => id is KindedID<Kind>;

// A source declares each link type it writes beside its tables. `schema:generate` reads every
// source's link types and writes the registry that the API and the host check links against.
export interface LinkTypeDeclaration<
  Name extends string = string,
  From extends EntityKind = EntityKind,
  To extends EntityKind = EntityKind,
> {
  readonly name: Name;
  readonly from: readonly From[];
  readonly to: readonly To[];

  // Whether the neighbourhood walk skips this link type unless the query asks for hubs.
  readonly hub: boolean;
}

// The generated registry: each link type's name, with the kinds allowed at each end.
export type LinkRegistry = Readonly<
  Record<string, { readonly from: readonly EntityKind[]; readonly to: readonly EntityKind[] }>
>;

// The registry that the generator writes from a set of declarations.
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

// A link's target: a known entity, or a reference that the alias table resolves at query time.
// Consumers, the API and the store use this one shape.
export type LinkTarget<To extends EntityKind> =
  | { kind: 'entity'; id: KindedID<To> }
  | { kind: 'reference'; reference: Reference };

// Where a link came from. The host fills in `consumer` from the consumer's name; a manual link
// takes its origin from the client that the manual fact records.
export type LinkOrigin =
  | { kind: 'consumer'; name: string }
  | { kind: 'manual'; client: ClientID; fact: FactID };

// One union member per link type, so a type name stays paired with the kinds it allows. An
// `Omit` over this union would lose that pairing.
export type LinkEnds<Registry extends LinkRegistry> = {
  [Name in LinkTypeName<Registry>]: {
    type: Name;
    from: KindedID<LinkTypeSources<Registry, Name>>;
    to: LinkTarget<LinkTypeTargets<Registry, Name>>;
  };
}[LinkTypeName<Registry>];

export interface LinkDetails {
  // A scope-mode consumer's links are replaced as a set for each scope.
  scope: string | null;

  // From 0 to 1. A manual link from the owner is 1; an agent's link is below 1.
  confidence: number;
  evidence: string;
}

// One link, as a consumer returns it.
export type Link<Registry extends LinkRegistry> = LinkEnds<Registry> & LinkDetails;

// One link, as the effective link view serves it.
export type EffectiveLink<Registry extends LinkRegistry> = Link<Registry> & { origin: LinkOrigin };

// A retraction removes a link for every origin.
export type LinkRetraction<Registry extends LinkRegistry> = LinkEnds<Registry>;
