// Trace: an agent asserts a link over MCP, the manual-link consumer writes it, the neighbourhood
// query serves it, and the owner retracts it. It only has to compile; no test runs it.
import type { FactEnvelope } from '@pepys/schema';
import type {
  ConsumerOutcome,
  ConsumerReads,
  FactInput,
  FactOperation,
} from '../consumer-execution.ts';
import type { StreamOffset } from '../ids.ts';
import type { KindedID, LinkRegistryOf, LinkTypeDeclaration } from '../link-registry.ts';
import type { Catalog, CoreQueries, CoreWrites, Principal } from '../query-catalog.ts';

type Registry = LinkRegistryOf<LinkTypeDeclaration<'mentions', 'gmail:msg', 'github:issue'>>;

export interface AgentLinkTrace {
  writes: Catalog<CoreWrites<Registry>, unknown>;
  queries: Catalog<CoreQueries<Registry>, unknown>;
  manualLinks: (
    input: FactInput,
    reads: ConsumerReads<unknown>,
  ) => ConsumerOutcome<FactOperation<unknown, Registry>>;
  reads: ConsumerReads<unknown>;
  agent: Principal;
  owner: Principal;
}

export interface AgentLinkEvent {
  email: KindedID<'gmail:msg'>;
  issue: KindedID<'github:issue'>;
  read: (offset: StreamOffset) => Promise<{ offset: StreamOffset; fact: FactEnvelope<unknown> }>;
}

export async function runAgentLinkTrace(
  trace: AgentLinkTrace,
  event: AgentLinkEvent,
): Promise<{ before: number; after: number }> {
  const asserted = await trace.writes.assertLink.run(undefined, trace.agent, {
    type: 'mentions',
    from: event.email,
    to: { kind: 'entity', id: event.issue },
    confidence: 0.8,
    evidence: 'the email quotes the issue title',
  });

  if (!asserted.ok) {
    return { before: 0, after: 0 };
  }

  const stored = await event.read(toOffset(0));

  trace.manualLinks({ mode: 'fact', offset: stored.offset, fact: stored.fact }, trace.reads);

  const before = await trace.queries.neighbourhood.run(undefined, trace.owner, {
    id: event.email,
    depthLimit: 1,
    linkTypes: ['mentions'],
    includeHubs: false,
    minimumConfidence: 0.5,
  });

  await trace.writes.retractLink.run(undefined, trace.owner, {
    type: 'mentions',
    from: event.email,
    to: { kind: 'entity', id: event.issue },
    reason: 'unrelated',
  });

  const after = await trace.queries.neighbourhood.run(undefined, trace.owner, {
    id: event.email,
    depthLimit: 1,
    linkTypes: ['mentions'],
    includeHubs: false,
    minimumConfidence: 0.5,
  });

  return {
    before: before.ok ? before.value.links.length : 0,
    after: after.ok ? after.value.links.length : 0,
  };
}

declare function toOffset(value: number): StreamOffset;
