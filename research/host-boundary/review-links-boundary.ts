import type { Review, ReviewID } from '../scriptc-wasm/build-review-links.ts';
import { buildReviewLinks } from '../scriptc-wasm/build-review-links.ts';
import { parseReviewLinkInput } from '../scriptc-wasm/parse-review-link-input.ts';

declare function readReviewLength(reviewID: string): number;
declare function readReviewInto(reviewID: string, row: Uint8Array): void;

export function deriveFromInput(inputJSON: string): string {
  const input = parseReviewLinkInput(inputJSON);

  return input === undefined ? '' : JSON.stringify(buildReviewLinks(input));
}

export function deriveWithReads(inputJSON: string): string {
  const input = parseReviewLinkInput(inputJSON);

  if (input === undefined) {
    return '';
  }

  const reviewIDs: ReviewID[] = [];

  for (const finding of input.findings) {
    if (!reviewIDs.includes(finding.reviewID)) {
      reviewIDs.push(finding.reviewID);
    }
  }

  const reviews: Review[] = [];

  for (const id of reviewIDs) {
    const length = readReviewLength(id);

    if (length >= 0) {
      const row = new Uint8Array(length);

      readReviewInto(id, row);

      const pullRequestNumber = parsePullRequestNumber(new TextDecoder().decode(row));

      if (pullRequestNumber !== undefined) {
        reviews.push({ id, pullRequestNumber });
      }
    }
  }

  return JSON.stringify(buildReviewLinks({ ...input, reviews }));
}

export interface ReviewLinkModel {
  operationsJSON: string;
}

export type ReviewLinkMessage = { kind: 'derive'; inputJSON: string } | { kind: 'reset' };

export function init(): ReviewLinkModel {
  return { operationsJSON: '' };
}

export function update(model: ReviewLinkModel, message: ReviewLinkMessage): ReviewLinkModel {
  if (message.kind === 'reset') {
    return init();
  }

  return { ...model, operationsJSON: deriveWithReads(message.inputJSON) };
}

function parsePullRequestNumber(rowJSON: string): number | undefined {
  const row: unknown = JSON.parse(rowJSON);

  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    return undefined;
  }

  // scriptc 0.3.5 crashes compiling Reflect.get on a parsed value, so the row narrows with `in`.
  if (!('pullRequestNumber' in row) || typeof row.pullRequestNumber !== 'number') {
    return undefined;
  }

  return row.pullRequestNumber;
}
