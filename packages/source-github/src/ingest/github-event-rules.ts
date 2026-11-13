import type { FactFamily } from '@pepys/kit';
import { z } from 'zod';
import { deploymentFamily } from '../families/deployment-family.ts';
import { issueCommentFamily } from '../families/issue-comment-family.ts';
import { issueFamily } from '../families/issue-family.ts';
import { pullRequestFamily } from '../families/pull-request-family.ts';
import { pullRequestReviewFamily } from '../families/pull-request-review-family.ts';
import { refFamily } from '../families/ref-family.ts';
import { releaseFamily } from '../families/release-family.ts';
import { repositoryFamily } from '../families/repository-family.ts';
import { reviewCommentFamily } from '../families/review-comment-family.ts';
import { reviewThreadFamily } from '../families/review-thread-family.ts';
import { workflowRunFamily } from '../families/workflow-run-family.ts';

// What a rule reads from one delivery body. `locator` is the API path the resync pull reads the
// entity at.
interface GithubFactFields {
  type: string;
  entity: string;
  actor: string | undefined;
  at: string;
  locator: string | undefined;
}

// `ignored`: a delivery pepys does not keep, such as a push to a feature branch, or an action that
// the family does not list. `invalid`: the body is not what the event documents.
export interface GithubEventRule {
  readonly family: FactFamily;
  readonly read: (body: unknown) => GithubFactFields | 'ignored' | 'invalid';
}

const senderSchema = z.looseObject({ id: z.number().int() }).optional();
const timeSchema = z.string().min(1);

const pullRequestBodySchema = z.looseObject({
  action: z.string().min(1),
  pull_request: z.looseObject({
    id: z.number().int(),
    updated_at: timeSchema,
    url: z.string().optional(),
  }),
  sender: senderSchema,
});

const releaseBodySchema = z.looseObject({
  action: z.string().min(1),
  release: z.looseObject({
    id: z.number().int(),
    url: z.string().optional(),
    created_at: timeSchema,
    published_at: timeSchema.nullish(),
    updated_at: timeSchema.nullish(),
  }),
  sender: senderSchema,
});

const pushedAtSchema = z.union([z.number(), z.string()]).nullish();

const pushRepositorySchema = z.looseObject({
  id: z.number().int(),
  default_branch: z.string(),
  pushed_at: pushedAtSchema,
});

const pushBodySchema = z.looseObject({
  ref: z.string().min(1),
  repository: pushRepositorySchema,
  head_commit: z.looseObject({ timestamp: timeSchema }).nullish(),
  sender: senderSchema,
});

const deploymentBodySchema = z.looseObject({
  deployment: z.looseObject({ id: z.number().int(), created_at: timeSchema }),
  sender: senderSchema,
});

const deploymentStatusBodySchema = z.looseObject({
  deployment_status: z.looseObject({ created_at: timeSchema }),
  deployment: z.looseObject({ id: z.number().int() }),
  sender: senderSchema,
});

const workflowRunBodySchema = z.looseObject({
  action: z.string().min(1),
  workflow_run: z.looseObject({ id: z.number().int(), updated_at: timeSchema }),
  sender: senderSchema,
});

const issueBodySchema = z.looseObject({
  action: z.string().min(1),
  issue: z.looseObject({ id: z.number().int(), updated_at: timeSchema }),
  sender: senderSchema,
});

const reviewBodySchema = z.looseObject({
  action: z.string().min(1),
  review: z.looseObject({ id: z.number().int(), submitted_at: timeSchema.nullish() }),
  pull_request: z.looseObject({ updated_at: timeSchema }),
  sender: senderSchema,
});

const commentBodySchema = z.looseObject({
  action: z.string().min(1),
  comment: z.looseObject({ id: z.number().int(), updated_at: timeSchema }),
  sender: senderSchema,
});

const threadCommentSchema = z.looseObject({
  id: z.number().int(),
  in_reply_to_id: z.number().int().nullish(),
});

const reviewThreadBodySchema = z.looseObject({
  action: z.string().min(1),
  thread: z.looseObject({ comments: z.array(threadCommentSchema) }),
  updated_at: timeSchema.nullish(),
  pull_request: z.looseObject({ updated_at: timeSchema }),
  sender: senderSchema,
});

const repositoryBodySchema = z.looseObject({
  action: z.string().min(1),
  repository: z.looseObject({
    id: z.number().int(),
    created_at: timeSchema.nullish(),
    updated_at: timeSchema.nullish(),
  }),
  sender: senderSchema,
});

// One rule per webhook event name. Any other event is ignored.
export const githubEventRules: Readonly<Record<string, GithubEventRule>> = {
  pull_request: {
    family: pullRequestFamily,
    read: (body) => {
      const parsed = pullRequestBodySchema.safeParse(body);

      if (!parsed.success) {
        return 'invalid';
      }

      const pullRequest = parsed.data.pull_request;

      return pickFields(pullRequestFamily, `github.pull_request.${parsed.data.action}`, {
        entity: `github:pull_request:${pullRequest.id}`,
        actor: parsed.data.sender,
        time: pullRequest.updated_at,
        locator: toAPIPath(pullRequest.url),
      });
    },
  },
  release: {
    family: releaseFamily,
    read: (body) => {
      const parsed = releaseBodySchema.safeParse(body);

      if (!parsed.success) {
        return 'invalid';
      }

      const release = parsed.data.release;

      return pickFields(releaseFamily, `github.release.${parsed.data.action}`, {
        entity: `github:release:${release.id}`,
        actor: parsed.data.sender,
        time: release.updated_at ?? release.published_at ?? release.created_at,
        locator: toAPIPath(release.url),
      });
    },
  },
  push: {
    family: refFamily,
    read: (body) => {
      const parsed = pushBodySchema.safeParse(body);

      if (!parsed.success) {
        return 'invalid';
      }

      const push = parsed.data;
      const isDefaultBranch = push.ref === `refs/heads/${push.repository.default_branch}`;

      if (!isDefaultBranch && !push.ref.startsWith('refs/tags/')) {
        return 'ignored';
      }

      // A push gives its time as seconds, or as text with an offset; the fact holds one form, so
      // the times of two pushes compare as text.
      const pushedAt = push.repository.pushed_at;

      const timeValue =
        typeof pushedAt === 'number'
          ? pushedAt * 1000
          : (pushedAt ?? push.head_commit?.timestamp ?? '');

      const time = new Date(timeValue);

      return pickFields(refFamily, 'github.ref.pushed', {
        entity: `github:ref:${push.repository.id}:${push.ref}`,
        actor: push.sender,
        time: Number.isNaN(time.getTime()) ? undefined : time.toISOString(),
        locator: undefined,
      });
    },
  },
  deployment: {
    family: deploymentFamily,
    read: (body) => {
      const parsed = deploymentBodySchema.safeParse(body);

      if (!parsed.success) {
        return 'invalid';
      }

      return pickFields(deploymentFamily, 'github.deployment.created', {
        entity: `github:deployment:${parsed.data.deployment.id}`,
        actor: parsed.data.sender,
        time: parsed.data.deployment.created_at,
        locator: undefined,
      });
    },
  },
  deployment_status: {
    family: deploymentFamily,
    read: (body) => {
      const parsed = deploymentStatusBodySchema.safeParse(body);

      if (!parsed.success) {
        return 'invalid';
      }

      return pickFields(deploymentFamily, 'github.deployment.status_created', {
        entity: `github:deployment:${parsed.data.deployment.id}`,
        actor: parsed.data.sender,
        time: parsed.data.deployment_status.created_at,
        locator: undefined,
      });
    },
  },
  workflow_run: {
    family: workflowRunFamily,
    read: (body) => {
      const parsed = workflowRunBodySchema.safeParse(body);

      if (!parsed.success) {
        return 'invalid';
      }

      return pickFields(workflowRunFamily, `github.workflow_run.${parsed.data.action}`, {
        entity: `github:workflow_run:${parsed.data.workflow_run.id}`,
        actor: parsed.data.sender,
        time: parsed.data.workflow_run.updated_at,
        locator: undefined,
      });
    },
  },
  issues: {
    family: issueFamily,
    read: (body) => {
      const parsed = issueBodySchema.safeParse(body);

      if (!parsed.success) {
        return 'invalid';
      }

      return pickFields(issueFamily, `github.issue.${parsed.data.action}`, {
        entity: `github:issue:${parsed.data.issue.id}`,
        actor: parsed.data.sender,
        time: parsed.data.issue.updated_at,
        locator: undefined,
      });
    },
  },
  pull_request_review: {
    family: pullRequestReviewFamily,
    read: (body) => {
      const parsed = reviewBodySchema.safeParse(body);

      if (!parsed.success) {
        return 'invalid';
      }

      const review = parsed.data.review;

      return pickFields(
        pullRequestReviewFamily,
        `github.pull_request_review.${parsed.data.action}`,
        {
          entity: `github:pull_request_review:${review.id}`,
          actor: parsed.data.sender,
          time: review.submitted_at ?? parsed.data.pull_request.updated_at,
          locator: undefined,
        },
      );
    },
  },
  pull_request_review_comment: {
    family: reviewCommentFamily,
    read: (body) => {
      const parsed = commentBodySchema.safeParse(body);

      if (!parsed.success) {
        return 'invalid';
      }

      return pickFields(reviewCommentFamily, `github.review_comment.${parsed.data.action}`, {
        entity: `github:review_comment:${parsed.data.comment.id}`,
        actor: parsed.data.sender,
        time: parsed.data.comment.updated_at,
        locator: undefined,
      });
    },
  },
  pull_request_review_thread: {
    family: reviewThreadFamily,
    read: (body) => {
      const parsed = reviewThreadBodySchema.safeParse(body);

      if (!parsed.success) {
        return 'invalid';
      }

      const firstCommentID = findFirstCommentID(parsed.data.thread.comments);

      if (firstCommentID === undefined) {
        return 'invalid';
      }

      return pickFields(reviewThreadFamily, `github.review_thread.${parsed.data.action}`, {
        entity: `github:review_thread:${firstCommentID}`,
        actor: parsed.data.sender,
        time: parsed.data.updated_at ?? parsed.data.pull_request.updated_at,
        locator: undefined,
      });
    },
  },
  issue_comment: {
    family: issueCommentFamily,
    read: (body) => {
      const parsed = commentBodySchema.safeParse(body);

      if (!parsed.success) {
        return 'invalid';
      }

      return pickFields(issueCommentFamily, `github.issue_comment.${parsed.data.action}`, {
        entity: `github:issue_comment:${parsed.data.comment.id}`,
        actor: parsed.data.sender,
        time: parsed.data.comment.updated_at,
        locator: undefined,
      });
    },
  },
  repository: {
    family: repositoryFamily,
    read: (body) => {
      const parsed = repositoryBodySchema.safeParse(body);

      if (!parsed.success) {
        return 'invalid';
      }

      const repository = parsed.data.repository;

      return pickFields(repositoryFamily, `github.repository.${parsed.data.action}`, {
        entity: `github:repo:${repository.id}`,
        actor: parsed.data.sender,
        time: repository.updated_at ?? repository.created_at,
        locator: undefined,
      });
    },
  },
};

interface RuleValues {
  entity: string;
  actor: { id: number } | undefined;
  time: string | null | undefined;
  locator: string | undefined;
}

// An action the family does not list is ignored, so GitHub records no failed delivery for it. A
// time with an offset, as a push's commit gives, is written in UTC.
function pickFields(
  family: FactFamily,
  type: string,
  values: RuleValues,
): GithubFactFields | 'ignored' | 'invalid' {
  if (!Object.hasOwn(family.types, type)) {
    return 'ignored';
  }

  const at = toFactTime(values.time);

  if (at === undefined) {
    return 'invalid';
  }

  return {
    type,
    entity: values.entity,
    actor: values.actor === undefined ? undefined : `github:user:${values.actor.id}`,
    at,
    locator: values.locator,
  };
}

const utcTimeSchema = z.iso.datetime();

function toFactTime(time: string | null | undefined): string | undefined {
  if (time === null || time === undefined) {
    return undefined;
  }

  if (utcTimeSchema.safeParse(time).success) {
    return time;
  }

  const date = new Date(time);

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

// The resync pull reads only the path, from the API origin it knows.
function toAPIPath(url: string | undefined): string | undefined {
  if (url === undefined || !URL.canParse(url)) {
    return undefined;
  }

  const path = new URL(url).pathname;

  return path.startsWith('/repos/') ? path : undefined;
}

// GitHub points every reply at the first comment of its thread, so a thread whose first comment
// was deleted still gives that comment's ID.
function findFirstCommentID(
  comments: readonly z.infer<typeof threadCommentSchema>[],
): number | undefined {
  const first = comments.find(
    (comment) => comment.in_reply_to_id === undefined || comment.in_reply_to_id === null,
  );

  return first?.id ?? comments[0]?.in_reply_to_id ?? undefined;
}
