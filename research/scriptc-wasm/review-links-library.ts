import type { Review, ReviewID } from './build-review-links.ts';
import { buildReviewLinks } from './build-review-links.ts';
import { parseReviewLinkInput } from './parse-review-link-input.ts';

declare function readPullRequestNumber(reviewID: string): number;

export function deriveReviewLinks(inputJSON: string): string {
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
    const pullRequestNumber = readPullRequestNumber(id);

    if (pullRequestNumber >= 0) {
      reviews.push({ id, pullRequestNumber });
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

  return { ...model, operationsJSON: deriveReviewLinks(message.inputJSON) };
}
