import { expect, test } from 'bun:test';
import { githubPullRequestSchemaPath } from './github-pull-request-schema-path.ts';

test('it points at the generated schema that creates the pull request table', async () => {
  const schema = await Bun.file(githubPullRequestSchemaPath).text();

  expect(schema).toInclude('CREATE TABLE "github_pull_request"');
});
