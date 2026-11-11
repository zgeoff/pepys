// A pull request delivery body from a bot whose description links a kit release.
export function buildBotPullRequestBody(updatedAt: string, tag: string) {
  return {
    action: 'edited',
    pull_request: {
      id: 88,
      number: 14,
      title: 'Bump the kit',
      state: 'open',
      url: 'https://api.github.com/repos/acme/harbour/pulls/14',
      html_url: 'https://github.example/acme/harbour/pull/14',
      user: { id: 9001, type: 'Bot' },
      base: { repo: { id: 902 } },
      body: `Release notes: https://github.com/acme/kit/releases/tag/${tag}`,
      created_at: '2026-10-01T09:00:00Z',
      updated_at: updatedAt,
    },
  };
}
