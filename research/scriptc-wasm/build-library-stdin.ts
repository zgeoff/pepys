import type { Review } from './build-review-links.ts';
import { parseReviewLinkInput } from './parse-review-link-input.ts';

export interface LibraryStdin {
  bytes: Uint8Array;
  inputJSON: string;
  reviews: Review[];
}

// The library driver reads [u32 table length][records][input JSON], each record being
// [u32 ID length][ID bytes][f64 pull request number], all little-endian.
export function buildLibraryStdin(stdin: string): LibraryStdin {
  const input = parseReviewLinkInput(stdin);
  const reviews = input?.reviews ?? [];
  const inputJSON = input === undefined ? stdin : JSON.stringify({ ...input, reviews: [] });

  const encoder = new TextEncoder();

  const records = reviews.map((review) => {
    const id = encoder.encode(review.id);

    const record = new Uint8Array(4 + id.length + 8);
    const view = new DataView(record.buffer);

    view.setUint32(0, id.length, true);
    record.set(id, 4);
    view.setFloat64(4 + id.length, review.pullRequestNumber, true);

    return record;
  });

  const tableLength = records.reduce((total, record) => total + record.length, 0);
  const json = encoder.encode(inputJSON);

  const bytes = new Uint8Array(4 + tableLength + json.length);

  let offset = 4;

  new DataView(bytes.buffer).setUint32(0, tableLength, true);

  for (const record of records) {
    bytes.set(record, offset);

    offset += record.length;
  }

  bytes.set(json, offset);

  return { bytes, inputJSON, reviews };
}
