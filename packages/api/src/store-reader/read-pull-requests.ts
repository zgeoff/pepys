import type { Result } from '@pepys/kit';
import type { Selectable } from 'kysely';
import type { ConsumerDB, StoreReader } from './store-reader.ts';

type PullRequestRow = Selectable<ConsumerDB['github_pull_request']>;

export function readPullRequests(
  store: StoreReader,
): Promise<Result<PullRequestRow[], { reason: 'no-current-version' }>> {
  return store.withConsumer('github_pull_request', (transaction) =>
    transaction.selectFrom('github_pull_request').selectAll().orderBy('id').execute(),
  );
}
