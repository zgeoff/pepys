import { sql } from 'kysely';
import type { RawBuilder } from 'kysely';
import { z } from 'zod';
import { deploySignals } from '../utils/deploy-signals.ts';
import type { DeploySignal } from '../utils/deploy-signals.ts';

interface DeliveryOptions {
  // at least one
  pullRequests: readonly [string, ...string[]];
  environment: string;

  // Absent: a deploy of any target, and of none, counts. Given: only a deploy of that target.
  target?: string | undefined;
}

// The statement that ties pull requests to releases and deploys. The rules it holds are in the
// "Delivery query" section of the plug-ins design doc. Run it with `.execute(db)`, and turn its rows
// into deliveries with the parse function below.
export function selectPullRequestDelivery(options: DeliveryOptions): RawBuilder<unknown> {
  return sql`select
    pull_request.id as "pullRequest",
    pull_request.merged_at as "mergedAt",
    release.id as "releaseID",
    release.tag_name as "releaseTag",
    release.published_at as "releaseAt",
    deploy.id as "deployID",
    deploy.deployed_at as "deployAt",
    deploy.signal as "deploySignal"
  from github_pull_request as pull_request
  left join github_release as release on release.id = ${selectFirstReleaseID()}
  left join github_deploy as deploy on deploy.id = ${selectFirstDeployID(options)}
  where pull_request.id in (${sql.join(options.pullRequests)})
  order by pull_request.id`;
}

function selectFirstReleaseID(): RawBuilder<unknown> {
  const releaseTime = formatCommitTime(
    'candidate.repository_id',
    'candidate.target_commitish',
    'candidate.created_at',
  );

  return sql`(select candidate.id from github_release as candidate
    where ${formatContains('candidate')}
    order by ${releaseTime}, candidate.id
    limit 1)`;
}

// The commit time of a sha of a repository, or the fallback time. The three names are columns.
function formatCommitTime(repository: string, sha: string, fallback: string): RawBuilder<unknown> {
  return sql`julianday(coalesce((select commit_row.committed_at from github_commit as commit_row
    where commit_row.repository_id = ${sql.ref(repository)}
      and commit_row.sha = ${sql.ref(sha)}), ${sql.ref(fallback)}))`;
}

// The release under `alias` contains `pull_request`.
function formatContains(alias: string): RawBuilder<unknown> {
  const release = sql.table(alias);

  const releaseTime = formatCommitTime(
    `${alias}.repository_id`,
    `${alias}.target_commitish`,
    `${alias}.created_at`,
  );

  const mergeTime = formatCommitTime(
    'pull_request.repository_id',
    'pull_request.merge_commit_sha',
    'pull_request.merged_at',
  );

  return sql`(pull_request.merged_at is not null
    and ${release}.repository_id = pull_request.repository_id
    and ${release}.published_at is not null
    and ${release}.is_draft = 0
    and ${release}.deleted_at is null
    and ${releaseTime} >= ${mergeTime})`;
}

function selectFirstDeployID(options: DeliveryOptions): RawBuilder<unknown> {
  const target = options.target ?? null;

  const deployTime = formatCommitTime(
    'carrier.repository_id',
    'carrier.sha',
    'carrier.deployed_at',
  );

  const pinnerMergeTime = formatCommitTime(
    'pinner.repository_id',
    'pinner.merge_commit_sha',
    'pinner.merged_at',
  );

  return sql`(select carrier.id from github_deploy as carrier
    join github_pull_request as pinner
      on pinner.repository_id = carrier.repository_id and pinner.merged_at is not null
    join github_release_bump as bump on bump.pull_request_id = pinner.id
    join github_release as pinned
      on pinned.repository_full_name = bump.release_repository
      and pinned.tag_name = bump.release_tag
    where ${formatContains('pinned')}
      and carrier.environment = ${options.environment}
      and (${target} is null or carrier.target = ${target})
      and carrier.signal = (case when exists (
        select 1 from github_deploy as tagged
        where tagged.repository_id = carrier.repository_id
          and tagged.environment = carrier.environment
          and (${target} is null or tagged.target = ${target})
          and tagged.signal = 'tag'
      ) then 'tag' else 'deployment_status' end)
      and ${deployTime} >= ${pinnerMergeTime}
    order by julianday(carrier.deployed_at), carrier.id
    limit 1)`;
}

export interface PullRequestDelivery {
  pullRequest: string;
  mergedAt: string | null;
  release: { id: string; tag: string; at: string } | null;
  deploy: { id: string; at: string; signal: DeploySignal } | null;
}

const textSchema = z.string().nullable();

// One row per pull request, as the statement selects it.
const deliveryRowSchema = z.object({
  pullRequest: z.string(),
  mergedAt: textSchema,
  releaseID: textSchema,
  releaseTag: textSchema,
  releaseAt: textSchema,
  deployID: textSchema,
  deployAt: textSchema,
  deploySignal: z.enum(deploySignals).nullable(),
});

const deliveryRowsSchema = z.array(deliveryRowSchema);

// The rows of the statement as deliveries. A row of another shape is a bug in the statement, so the
// parse throws.
export function parsePullRequestDeliveries(rows: unknown): PullRequestDelivery[] {
  return deliveryRowsSchema.parse(rows).map((row) => ({
    pullRequest: row.pullRequest,
    mergedAt: row.mergedAt,
    release:
      row.releaseID === null || row.releaseTag === null || row.releaseAt === null
        ? null
        : { id: row.releaseID, tag: row.releaseTag, at: row.releaseAt },
    deploy:
      row.deployID === null || row.deployAt === null || row.deploySignal === null
        ? null
        : { id: row.deployID, at: row.deployAt, signal: row.deploySignal },
  }));
}
