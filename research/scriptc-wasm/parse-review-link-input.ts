import type {
  Commit,
  CommitID,
  FindingID,
  Review,
  ReviewFinding,
  ReviewID,
  ReviewLinkInput,
} from './build-review-links.ts';

export function parseReviewLinkInput(text: string): ReviewLinkInput | undefined {
  const value: unknown = JSON.parse(text);

  if (!isRecord(value)) {
    return undefined;
  }

  const findings = parseList(value['findings'], parseFinding);
  const commits = parseList(value['commits'], parseCommit);
  const reviews = parseList(value['reviews'], parseReview);
  const existingLinkKeys = parseList(value['existingLinkKeys'], parseText);

  if (
    findings === undefined ||
    commits === undefined ||
    reviews === undefined ||
    existingLinkKeys === undefined
  ) {
    return undefined;
  }

  return { findings, commits, reviews, existingLinkKeys };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseList<T>(
  value: unknown,
  parseItem: (item: unknown) => T | undefined,
): T[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items: T[] = [];

  for (const item of value) {
    const parsed = parseItem(item);

    if (parsed === undefined) {
      return undefined;
    }

    items.push(parsed);
  }

  return items;
}

function parseFinding(value: unknown): ReviewFinding | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = value['id'];
  const reviewID = value['reviewID'];
  const path = value['path'];
  const line = value['line'];
  const body = value['body'];

  if (
    typeof id !== 'string' ||
    !isFindingID(id) ||
    typeof reviewID !== 'string' ||
    !isReviewID(reviewID) ||
    typeof path !== 'string' ||
    typeof line !== 'number' ||
    typeof body !== 'string'
  ) {
    return undefined;
  }

  return { id, reviewID, path, line, body };
}

const findingIDPattern = /^github:review-comment:\d+$/u;

function isFindingID(value: string): value is FindingID {
  return findingIDPattern.test(value);
}

const reviewIDPattern = /^github:review:\d+$/u;

function isReviewID(value: string): value is ReviewID {
  return reviewIDPattern.test(value);
}

function parseCommit(value: unknown): Commit | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = value['id'];
  const sha = value['sha'];
  const message = value['message'];

  if (
    typeof id !== 'string' ||
    !isCommitID(id) ||
    typeof sha !== 'string' ||
    typeof message !== 'string'
  ) {
    return undefined;
  }

  return { id, sha, message };
}

const commitIDPattern = /^github:commit:[0-9a-f]{40}$/u;

function isCommitID(value: string): value is CommitID {
  return commitIDPattern.test(value);
}

function parseReview(value: unknown): Review | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = value['id'];
  const pullRequestNumber = value['pullRequestNumber'];

  if (typeof id !== 'string' || !isReviewID(id) || typeof pullRequestNumber !== 'number') {
    return undefined;
  }

  return { id, pullRequestNumber };
}

function parseText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
