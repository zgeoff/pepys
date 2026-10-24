declare const idTag: unique symbol;

export type FindingID = string & { readonly [idTag]: 'FindingID' };

export type ReviewID = string & { readonly [idTag]: 'ReviewID' };

export type CommitID = string & { readonly [idTag]: 'CommitID' };

export interface ReviewFinding {
  id: FindingID;
  reviewID: ReviewID;
  path: string;
  line: number;
  body: string;
}

export interface Commit {
  id: CommitID;
  sha: string;
  message: string;
}

export interface Review {
  id: ReviewID;
  pullRequestNumber: number;
}

export interface ReviewLinkInput {
  findings: ReviewFinding[];
  commits: Commit[];
  reviews: Review[];
  existingLinkKeys: string[];
}

export interface ReviewLinkRow {
  findingID: FindingID;
  commitID: CommitID;
  pullRequestNumber: number;
  path: string;
  line: number;
  summary: string;
  matchedBy: string[];
}

export interface UpsertOperation {
  kind: 'upsert';
  table: string;
  key: string;
  row: ReviewLinkRow;
}

export interface DeleteOperation {
  kind: 'delete';
  table: string;
  key: string;
}

export type Operation = UpsertOperation | DeleteOperation;

const reviewLinksTable = 'review_links';

export function buildReviewLinks(input: ReviewLinkInput): Operation[] {
  const rows = new Map<string, ReviewLinkRow>();

  for (const commit of input.commits) {
    for (const findingID of collectTrailerFindingIDs(commit.message)) {
      const finding = input.findings.find((candidate) => candidate.id === findingID);

      if (finding !== undefined) {
        addMatch(rows, input.reviews, { finding, commit, matchedBy: 'trailer' });
      }
    }
  }

  for (const finding of input.findings) {
    for (const shaPrefix of collectFixedInPrefixes(finding.body)) {
      const commits = input.commits.filter((candidate) => candidate.sha.startsWith(shaPrefix));
      const [commit] = commits;

      if (commits.length === 1 && commit !== undefined) {
        addMatch(rows, input.reviews, { finding, commit, matchedBy: 'body' });
      }
    }
  }

  const upserts: Operation[] = [...rows.entries()]
    .toSorted(([leftKey], [rightKey]) => compareText(leftKey, rightKey))
    .map(([key, row]) => ({ kind: 'upsert', table: reviewLinksTable, key, row }));

  const deletes: Operation[] = input.existingLinkKeys
    .filter((key) => !rows.has(key))
    .toSorted(compareText)
    .map((key) => ({ kind: 'delete', table: reviewLinksTable, key }));

  return [...deletes, ...upserts];
}

const trailerPattern = /^Fixes-Finding:\s*(?<findingID>github:review-comment:\d+)\s*$/gmu;

function collectTrailerFindingIDs(message: string): string[] {
  const values: string[] = [];

  for (const match of message.matchAll(trailerPattern)) {
    const groups = match.groups;

    if (groups !== undefined) {
      const value = groups['findingID'];

      if (value !== undefined) {
        values.push(value);
      }
    }
  }

  return values;
}

interface LinkMatch {
  finding: ReviewFinding;
  commit: Commit;
  matchedBy: string;
}

function addMatch(rows: Map<string, ReviewLinkRow>, reviews: Review[], match: LinkMatch): void {
  const review = reviews.find((candidate) => candidate.id === match.finding.reviewID);

  if (review === undefined) {
    return;
  }

  const key = `${match.finding.id}|${match.commit.id}`;
  const existing = rows.get(key);

  if (existing !== undefined) {
    if (!existing.matchedBy.includes(match.matchedBy)) {
      existing.matchedBy = [...existing.matchedBy, match.matchedBy].toSorted(compareText);
    }

    return;
  }

  rows.set(key, {
    findingID: match.finding.id,
    commitID: match.commit.id,
    pullRequestNumber: review.pullRequestNumber,
    path: match.finding.path,
    line: match.finding.line,
    summary: buildSummary(match.finding.body),
    matchedBy: [match.matchedBy],
  });
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  return left > right ? 1 : 0;
}

const codeSpanPattern = /`(?<code>[^`]*)`/gu;
const whitespacePattern = /\s+/gu;

function buildSummary(body: string): string {
  const [firstLine = ''] = body.split('\n');

  return firstLine.replaceAll(codeSpanPattern, '$<code>').replaceAll(whitespacePattern, ' ').trim();
}

const fixedInPattern = /\bfixed in (?<shaPrefix>[0-9a-f]{7,40})\b/giu;

function collectFixedInPrefixes(body: string): string[] {
  const values: string[] = [];

  for (const match of body.matchAll(fixedInPattern)) {
    const groups = match.groups;

    if (groups !== undefined) {
      const value = groups['shaPrefix'];

      if (value !== undefined) {
        values.push(value.toLowerCase());
      }
    }
  }

  return values;
}
