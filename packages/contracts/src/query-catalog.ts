import type { ClientID, EntityID, FactID, Reference } from './ids.ts';
import type { EntityKind, LinkTarget } from './link-registry.ts';
import type { Provisional } from './provisional.ts';

// Who calls a query. The API resolves it from the OAuth token before the query runs.
export interface Principal {
  client: ClientID;
  scope: 'read' | 'read-write';
  isOwner: boolean;
}

export type QueryFailure =
  | { code: 'NOT_FOUND'; message: string }
  | { code: 'FORBIDDEN'; message: string }
  | { code: 'INVALID_INPUT'; message: string };

// One row of the shared `entity` view, which every consumer file defines.
export interface EntitySummary {
  id: EntityID;
  kind: EntityKind;
  title: string;
  url: string;
  actor: EntityID | null;
  updatedAt: string;
}

// The core catalog. Each entry becomes an oRPC route and an MCP tool from one definition, so the
// MCP tool list is this interface's keys.
export interface CoreQueries {
  getEntity: {
    input: { id: EntityID };
    output: {
      entity: EntitySummary;
      row: Readonly<Record<string, unknown>>;
      aliases: readonly Reference[];
    };
  };
  neighbourhood: {
    input: {
      id: EntityID;
      depthLimit: number;
      linkTypes: readonly string[] | null;
      includeHubs: boolean;
      minimumConfidence: number;
    };
    output: { entities: readonly EntitySummary[]; links: readonly NeighbourhoodLink[] };
  };

  search: Provisional<
    'leaf-ir-bun',
    {
      input: { text: string; kinds: readonly EntityKind[] | null; limit: number };
      output: { results: readonly { entity: EntitySummary; rank: number }[] };
    }
  >;
  entityHistory: {
    input: { id: EntityID; field: string | null };
    output: { transitions: readonly Transition[] };
  };
}

export interface NeighbourhoodLink {
  type: string;
  from: EntityID;
  to: LinkTarget<EntityKind>;
  confidence: number;
  depth: number;
}

export interface Transition {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  earliestAt: string;
  latestAt: string;
  fidelity: 'event' | 'observed';
}

// The core writes. Each appends one manual fact; none writes the store. An agent's link needs a
// confidence below 1 and evidence, and only the owner may correct a label.
export interface CoreWrites {
  assertLink: {
    input: {
      type: string;
      from: EntityID;
      to: LinkTarget<EntityKind>;
      confidence: number;
      evidence: string;
    };
    output: { fact: FactID };
  };
  retractLink: {
    input: { type: string; from: EntityID; to: LinkTarget<EntityKind>; reason: string };
    output: { fact: FactID };
  };
  correctLabel: {
    input: { entity: EntityID; job: string; label: string };
    output: { fact: FactID };
  };
}

// One entry of a catalog: a description for the MCP tool, and the run function.
export interface CatalogEntry<Input, Output, Context> {
  description: string;
  run: (
    context: Context,
    principal: Principal,
    input: Input,
  ) => Promise<{ ok: true; value: Output } | { ok: false; failure: QueryFailure }>;
}

export type Catalog<Definitions, Context> = {
  [Name in keyof Definitions]: Definitions[Name] extends {
    input: infer Input;
    output: infer Output;
  }
    ? CatalogEntry<Input, Output, Context>
    : never;
};
