// The fields of an invented pull request of the invented repository Acme/Harbour that every
// delivery about it carries. Its GitHub ID follows from its number, so pull request 12 is
// 1874433021.
export function buildPullRequestFields(number: number, updatedAt: string) {
  return {
    id: 1_874_433_009 + number,
    number,
    html_url: `https://github.example/Acme/Harbour/pull/${number}`,
    user: { id: 4401 },
    base: { repo: { id: 902 } },
    created_at: '2026-10-01T08:00:00Z',
    updated_at: updatedAt,
  };
}
