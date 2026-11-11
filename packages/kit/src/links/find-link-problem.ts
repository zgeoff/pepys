import { parseEntityID } from '../entity-ids/parse-entity-id.ts';
import type { CheckedLink, LinkCheckConsumer, LinkProblem } from './types.ts';

// The link check, from the consumer's declaration alone: it looks no row up, so a link to an
// entity that has not arrived passes. It reports the first problem in this order, which the host's
// Rust check keeps: the type, the `from` end, the `to` end, the confidence, the evidence.
export function findLinkProblem(
  consumer: LinkCheckConsumer,
  link: CheckedLink,
): LinkProblem | undefined {
  const linkType = consumer.links.find((declared) => declared.name === link.type);

  if (linkType === undefined) {
    return { kind: 'not-declared', type: link.type, consumer: consumer.name };
  }

  const endProblem =
    findEndProblem('from', link.from, linkType.from) ?? findEndProblem('to', link.to, linkType.to);

  if (endProblem !== undefined) {
    return endProblem;
  }

  if (!(link.confidence >= 0 && link.confidence <= 1)) {
    return { kind: 'bad-confidence', confidence: link.confidence };
  }

  if (link.evidence === '') {
    return { kind: 'no-evidence' };
  }

  return undefined;
}

function findEndProblem(
  end: 'from' | 'to',
  id: string,
  allowed: readonly string[],
): LinkProblem | undefined {
  const parsed = parseEntityID(id);

  if (!parsed.ok) {
    return { kind: 'not-an-entity-id', end, id };
  }

  const kind = `${parsed.value.source}:${parsed.value.kind}`;

  if (!allowed.some((allowedKind) => allowedKind === kind)) {
    return { kind: 'wrong-kind', end, id, allowed };
  }

  return undefined;
}
