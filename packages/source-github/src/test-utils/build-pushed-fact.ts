// A `github.ref.pushed` fact in the form the test store applies, for one commit of repository 902.
export function buildPushedFact(ref: string, sha: string, at: string) {
  return {
    type: 'github.ref.pushed' as const,
    event: `${ref}-${sha}-${at}`,
    entity: `github:ref:902:${ref}` as const,
    at,
    payload: {
      ref,
      repository: { id: 902, default_branch: 'main' },
      commits: [{ id: sha, timestamp: '2026-10-01T08:00:00Z' }],
      head_commit: { id: sha, timestamp: '2026-10-01T08:00:00Z' },
    },
  };
}
