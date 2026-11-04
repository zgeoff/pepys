import type { Tagged } from 'type-fest';
import type { ClientID, FactID, Reference } from './ids.ts';

// An entity kind is the first two parts of its IDs, such as `github:pr` or `gmail:msg`.
export type EntityKind = `${string}:${string}`;

// An entity ID that carries its kind in its type, so a link of the wrong kinds fails to compile.
export type KindedID<Kind extends EntityKind> = Tagged<`${Kind}:${string}`, 'EntityID'>;

// One entry of the link type registry. A source declares the link types it writes; the host reads
// the same registry and rejects a link operation whose ends have the wrong kinds.
export interface LinkTypeDeclaration<
  Name extends string = string,
  From extends EntityKind = EntityKind,
  To extends EntityKind = EntityKind,
> {
  readonly name: Name;
  readonly from: readonly From[];
  readonly to: readonly To[];

  // Whether a query that walks this link type in the neighbourhood skips it by default.
  readonly hub: boolean;
}

// A link's target: a known entity, or a reference that the alias table resolves at query time.
export type LinkTarget<To extends EntityKind> =
  | { kind: 'entity'; id: KindedID<To> }
  | { kind: 'reference'; reference: Reference };

// Where a link came from. The host fills in `consumer` from the consumer's name; a manual link
// takes its origin from the client that the manual fact records.
export type LinkOrigin =
  | { kind: 'consumer'; name: string }
  | { kind: 'manual'; client: ClientID; fact: FactID };

// One link, as a consumer returns it and as the effective link view serves it.
export interface Link<Type extends LinkTypeDeclaration> {
  type: Type['name'];
  from: KindedID<Type['from'][number]>;
  to: LinkTarget<Type['to'][number]>;

  // A scope-mode consumer's links are replaced as a set for each scope.
  scope: string | null;

  // From 0 to 1. A manual link from the owner is 1; an agent's link is below 1.
  confidence: number;
  evidence: string;
}

// A retraction removes a link for every origin.
export interface LinkRetraction<Type extends LinkTypeDeclaration> {
  type: Type['name'];
  from: KindedID<Type['from'][number]>;
  to: LinkTarget<Type['to'][number]>;
}
