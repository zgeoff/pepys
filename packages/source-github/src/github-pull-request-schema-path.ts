import { join } from 'node:path';

export const githubPullRequestSchemaPath = join(
  import.meta.dir,
  'generated/github-pull-request.sql',
);
