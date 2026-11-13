import type { ResumedPull } from './read-saved-cursors.ts';

// The start line of one pull timer. It says only whether a cursor was saved: a source chooses what
// its cursor holds, so the value stays out of the output.
export function formatPullStart(pull: ResumedPull): string {
  const detail = {
    source: pull.source,
    path: pull.path,
    cursor: pull.cursor === null ? 'none' : 'saved',
  };

  return `pull ${pull.source} ${pull.path} ${JSON.stringify(detail)}`;
}
