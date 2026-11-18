import type { Positions } from './types.ts';

export const retentionMs = 7 * 24 * 3_600_000;

interface SpoolFileFacts {
  name: string;
  size: number;
  day: string;
}

interface RetentionPlan {
  // files of an earlier day that are sent, with no `sentAt` yet
  markSent: string[];

  // files whose `sentAt` is 7 days old
  remove: string[];
}

// What retention does to the spool files. A file that holds an unsent line never goes in either
// list, and a file of the current day never goes in either.
export function collectRetention(
  files: readonly SpoolFileFacts[],
  positions: Positions,
  today: string,
  nowMs: number,
): RetentionPlan {
  const plan: RetentionPlan = { markSent: [], remove: [] };

  for (const file of files) {
    const position = positions[file.name] ?? { offset: 0 };

    if (file.day >= today || position.offset !== file.size) {
      continue;
    }

    if (position.sentAt === undefined) {
      plan.markSent.push(file.name);
      continue;
    }

    if (nowMs - Date.parse(position.sentAt) >= retentionMs) {
      plan.remove.push(file.name);
    }
  }

  return plan;
}
