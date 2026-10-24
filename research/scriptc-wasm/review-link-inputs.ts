export interface ReviewLinkCase {
  name: string;
  stdin: string;
}

const shaOne = '3f9a1c07be52d4e8a6017c93fd2b4e5a8c6d7e01';
const shaTwo = '3f9a1c0d44e0b1a2c3d4e5f60718293a4b5c6d7e';
const shaThree = 'a07b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b';
const reviewOne = { id: 'github:review:880001', pullRequestNumber: 42 };
const reviewTwo = { id: 'github:review:880002', pullRequestNumber: 57 };

export const reviewLinkCases: ReviewLinkCase[] = [
  {
    name: 'empty input',
    stdin: JSON.stringify({ findings: [], commits: [], reviews: [], existingLinkKeys: [] }),
  },
  {
    name: 'one commit trailer fixes two findings',
    stdin: JSON.stringify({
      findings: [
        {
          id: 'github:review-comment:7001',
          reviewID: reviewOne.id,
          path: 'src/parse-feed.ts',
          line: 12,
          body: 'Guard the `undefined` title before trimming.',
        },
        {
          id: 'github:review-comment:7002',
          reviewID: reviewOne.id,
          path: 'src/parse-feed.ts',
          line: 30,
          body: 'This loop   reads the list twice.',
        },
      ],
      commits: [
        {
          id: `github:commit:${shaThree}`,
          sha: shaThree,
          message:
            'fix: guard feed titles\n\nFixes-Finding: github:review-comment:7001\nFixes-Finding: github:review-comment:7002\n',
        },
      ],
      reviews: [reviewOne],
      existingLinkKeys: [],
    }),
  },
  {
    name: 'trailer and body mention merge on one link',
    stdin: JSON.stringify({
      findings: [
        {
          id: 'github:review-comment:7101',
          reviewID: reviewTwo.id,
          path: 'src/sync/cursor.ts',
          line: 88,
          body: 'Off by one at the page edge.\n\nFIXED IN A07B6C5, thanks.',
        },
      ],
      commits: [
        {
          id: `github:commit:${shaThree}`,
          sha: shaThree,
          message: 'fix: page edge\r\n\r\nFixes-Finding:   github:review-comment:7101  \r\n',
        },
      ],
      reviews: [reviewTwo],
      existingLinkKeys: [],
    }),
  },
  {
    name: 'ambiguous prefix, unknown finding and missing review give no link',
    stdin: JSON.stringify({
      findings: [
        {
          id: 'github:review-comment:7201',
          reviewID: reviewOne.id,
          path: 'src/index.ts',
          line: 3,
          body: 'Fixed in 3f9a1c0 or so.',
        },
        {
          id: 'github:review-comment:7202',
          reviewID: 'github:review:880999',
          path: 'src/index.ts',
          line: 9,
          body: 'fixed in 3f9a1c07be',
        },
      ],
      commits: [
        {
          id: `github:commit:${shaOne}`,
          sha: shaOne,
          message: 'Fixes-Finding: github:review-comment:9999',
        },
        {
          id: `github:commit:${shaTwo}`,
          sha: shaTwo,
          message: 'Fixes-Finding: github:review-comment:7202',
        },
      ],
      reviews: [reviewOne],
      existingLinkKeys: [],
    }),
  },
  {
    name: 'stale links become deletes in key order',
    stdin: JSON.stringify({
      findings: [
        {
          id: 'github:review-comment:7301',
          reviewID: reviewOne.id,
          path: 'README.md',
          line: 1,
          body: 'fixed in a07b6c5d4e3f',
        },
      ],
      commits: [{ id: `github:commit:${shaThree}`, sha: shaThree, message: 'docs: reword' }],
      reviews: [reviewOne],
      existingLinkKeys: [
        'github:review-comment:7399|github:commit:ffff',
        `github:review-comment:7301|github:commit:${shaThree}`,
        'github:review-comment:7300|github:commit:0000',
      ],
    }),
  },
  {
    name: 'non-ASCII text and regex metacharacters',
    stdin: JSON.stringify({
      findings: [
        {
          id: 'github:review-comment:7401',
          reviewID: reviewTwo.id,
          path: 'src/[id]/(group)/page.ts',
          line: 7,
          body: 'Le motif `^a.*b$` échoue sur « naïve » 🦀\t日本語\nfixed in 3f9a1c07',
        },
      ],
      commits: [
        { id: `github:commit:${shaOne}`, sha: shaOne, message: 'fix: motif (.*) — ok' },
        { id: `github:commit:${shaThree}`, sha: shaThree, message: 'chore: unrelated' },
      ],
      reviews: [reviewTwo],
      existingLinkKeys: ['github:review-comment:7401|github:commit:(.*)+?[x]'],
    }),
  },
  { name: 'input of 400 findings and 400 commits', stdin: JSON.stringify(buildLargeInput(400)) },
  { name: 'input with the wrong shape', stdin: JSON.stringify({ findings: 'none' }) },
];

function buildLargeInput(count: number): unknown {
  const indexes = Array.from({ length: count }, (_, index) => index);
  const shas = indexes.map((index) => index.toString(16).padStart(8, '0').repeat(5));

  return {
    findings: indexes.map((index) => ({
      id: `github:review-comment:${10_000 + index}`,
      reviewID: index % 2 === 0 ? reviewOne.id : reviewTwo.id,
      path: `src/module-${index % 17}.ts`,
      line: index + 1,
      body:
        index % 3 === 0 ? `Rename this. fixed in ${shas[index]?.slice(0, 12)}` : 'Rename `this`.',
    })),
    commits: indexes.map((index) => ({
      id: `github:commit:${shas[index]}`,
      sha: shas[index],
      message: `fix: rename ${index}\n\nFixes-Finding: github:review-comment:${10_000 + ((index * 7) % count)}`,
    })),
    reviews: [reviewOne, reviewTwo],
    existingLinkKeys: indexes
      .filter((index) => index % 5 === 0)
      .map((index) => `github:review-comment:${10_000 + index}|github:commit:stale${index}`),
  };
}
