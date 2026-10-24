import { readFileSync } from 'node:fs';
import { buildReviewLinks } from './build-review-links.ts';
import { parseReviewLinkInput } from './parse-review-link-input.ts';

const input = parseReviewLinkInput(readFileSync(0, 'utf8'));

if (input === undefined) {
  process.stderr.write('review link input does not match its shape\n');

  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify(buildReviewLinks(input))}\n`);
}
