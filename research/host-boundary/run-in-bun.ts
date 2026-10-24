import { parseReviewLinkInput } from '../scriptc-wasm/parse-review-link-input.ts';
import type { BoundaryShape } from './boundary-shapes.ts';
import { deriveFromInput, deriveWithReads } from './review-links-boundary.ts';

// Runs the same library code under Bun, with the reads served from the input's reviews the way
// the Rust host serves them.
export function runInBun(stdin: string, reads: BoundaryShape['reads']): string {
  if (reads === 'prefetch') {
    return deriveFromInput(stdin);
  }

  const input = parseReviewLinkInput(stdin);

  const encoder = new TextEncoder();

  const rows = new Map<string, Uint8Array>(
    (input?.reviews ?? []).map((review) => [review.id, encoder.encode(JSON.stringify(review))]),
  );

  Object.assign(globalThis, {
    readReviewLength: (reviewID: string): number => rows.get(reviewID)?.length ?? -1,
    readReviewInto: (reviewID: string, row: Uint8Array): void => {
      row.set(rows.get(reviewID)?.subarray(0, row.length) ?? []);
    },
  });

  const withoutReviews = input === undefined ? stdin : JSON.stringify({ ...input, reviews: [] });

  return deriveWithReads(withoutReviews);
}
