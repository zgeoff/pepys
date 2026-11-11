import { Collection } from '@msw/data';
import { HttpResponse, http } from 'msw';
import { z } from 'zod';
import { githubAPIURL } from '../ingest/github-app/github-api-url.ts';

export const GITHUB_API_URL = githubAPIURL;
const integerSchema = z.number().int();
const objectSchema = z.record(z.string(), z.unknown());

// A small GitHub: the repositories the App is installed on, their pull requests and releases, and
// the deliveries of the App's webhook. A pull request or release holds the JSON the API answers.
export const githubRepositories = new Collection({
  schema: z.object({
    id: integerSchema.default(902),
    fullName: z.string().default('acme/harbour'),
    installationID: integerSchema.default(31),
  }),
});

export const githubPullRequests = new Collection({
  schema: z.object({
    repository: z.string().default('acme/harbour'),
    number: integerSchema.default(1),
    record: objectSchema.default({}),
  }),
});

export const githubReleases = new Collection({
  schema: z.object({
    repository: z.string().default('acme/harbour'),
    id: integerSchema.default(1),
    record: objectSchema.default({}),
  }),
});

export const githubDeliveries = new Collection({
  schema: z.object({
    id: integerSchema.default(1),
    guid: z.string().default('0b1c2d3e-0000-4000-8000-000000000001'),
    deliveredAt: z.string().default('2026-10-01T09:00:00Z'),
    statusCode: integerSchema.default(200),
    event: z.string().default('pull_request'),
    payload: objectSchema.default({}),
  }),
});

// clears every collection; none references another, so the order does not matter
export function resetGithubAPI(): void {
  githubRepositories.clear();
  githubPullRequests.clear();
  githubReleases.clear();
  githubDeliveries.clear();
}

const deliveryPageSize = 2;

// The literal deliveries route comes before the route with a delivery ID, and the routes under a
// repository before the repository itself, on purpose: MSW matches in registration order.
export const githubAPIHandlers = [
  http.get(`${GITHUB_API_URL}/app/hook/deliveries`, (info) => {
    if (findAppID(info.request) === undefined) {
      return buildUnauthorized();
    }

    const url = new URL(info.request.url);

    const start = Number(url.searchParams.get('cursor') ?? '0');
    const newestFirst = githubDeliveries.all().toSorted((left, right) => right.id - left.id);
    const page = newestFirst.slice(start, start + deliveryPageSize);
    const nextStart = start + deliveryPageSize;

    const headers = new Headers();

    if (nextStart < newestFirst.length) {
      const next = new URL(url);

      next.searchParams.set('cursor', `${nextStart}`);
      headers.set('link', `<${next.href}>; rel="next"`);
    }

    return HttpResponse.json(
      page.map((delivery) => toDeliveryItem(delivery)),
      { headers },
    );
  }),
  http.get(`${GITHUB_API_URL}/app/hook/deliveries/:deliveryID`, (info) => {
    if (findAppID(info.request) === undefined) {
      return buildUnauthorized();
    }

    const id = Number(toParam(info.params['deliveryID']));
    const delivery = githubDeliveries.findFirst((query) => query.where({ id }));

    if (delivery === undefined) {
      return buildNotFound();
    }

    return HttpResponse.json({
      ...toDeliveryItem(delivery),
      url: '',
      request: { headers: { 'X-GitHub-Event': delivery.event }, payload: delivery.payload },
      response: { headers: {}, payload: null },
    });
  }),
  http.post(`${GITHUB_API_URL}/app/installations/:installationID/access_tokens`, (info) => {
    if (findAppID(info.request) === undefined) {
      return buildUnauthorized();
    }

    const token = `ghs_test_${toParam(info.params['installationID'])}`;

    return HttpResponse.json({ token, expires_at: '2099-01-01T00:00:00Z' }, { status: 201 });
  }),
  http.get(`${GITHUB_API_URL}/repos/:owner/:name/installation`, (info) => {
    if (findAppID(info.request) === undefined) {
      return buildUnauthorized();
    }

    const repository = findRepository(info.params);

    return repository === undefined
      ? buildNotFound()
      : HttpResponse.json({ id: repository.installationID, app_id: 1 });
  }),
  http.get(`${GITHUB_API_URL}/repos/:owner/:name/pulls/:number`, (info) => {
    const repository = findReadableRepository(info.request, info.params);
    const number = Number(toParam(info.params['number']));

    const pullRequest =
      repository === undefined
        ? undefined
        : githubPullRequests.findFirst((query) =>
            query.where({ repository: repository.fullName, number }),
          );

    return pullRequest === undefined ? buildNotFound() : HttpResponse.json(pullRequest.record);
  }),
  http.get(`${GITHUB_API_URL}/repos/:owner/:name/releases/:releaseID`, (info) => {
    const repository = findReadableRepository(info.request, info.params);
    const id = Number(toParam(info.params['releaseID']));

    const release =
      repository === undefined
        ? undefined
        : githubReleases.findFirst((query) => query.where({ repository: repository.fullName, id }));

    return release === undefined ? buildNotFound() : HttpResponse.json(release.record);
  }),
  http.get(`${GITHUB_API_URL}/repos/:owner/:name`, (info) => {
    const repository = findReadableRepository(info.request, info.params);

    if (repository === undefined) {
      return buildNotFound();
    }

    return HttpResponse.json({
      id: repository.id,
      full_name: repository.fullName,
      pushed_at: '2026-10-01T09:00:00Z',
    });
  }),
];

const claimsSchema = z.object({ iss: z.string().min(1) });

// The App's JWT: the mock reads its claims and does not check the signature.
function findAppID(request: Request): string | undefined {
  const token = request.headers.get('authorization')?.replace(/^Bearer /u, '') ?? '';
  const [, claims] = token.split('.');

  if (claims === undefined) {
    return undefined;
  }

  const parsed = claimsSchema.safeParse(parseClaims(claims));

  return parsed.success ? parsed.data.iss : undefined;
}

function parseClaims(segment: string): unknown {
  try {
    const claims: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));

    return claims;
  } catch {
    return undefined;
  }
}

function buildUnauthorized(): Response {
  return HttpResponse.json({ message: 'Bad credentials' }, { status: 401 });
}

interface StoredDelivery {
  id: number;
  guid: string;
  deliveredAt: string;
  statusCode: number;
  event: string;
}

function toDeliveryItem(delivery: StoredDelivery) {
  const isOK = delivery.statusCode >= 200 && delivery.statusCode < 300;

  return {
    id: delivery.id,
    guid: delivery.guid,
    delivered_at: delivery.deliveredAt,
    redelivery: false,
    duration: 0.2,
    status: isOK ? 'OK' : `Invalid HTTP Response: ${delivery.statusCode}`,
    status_code: delivery.statusCode,
    event: delivery.event,
    action: null,
    installation_id: 31,
    repository_id: 902,
  };
}

type PathParams = Readonly<Record<string, string | readonly string[] | undefined>>;

function toParam(value: PathParams[string]): string {
  return typeof value === 'string' ? value : '';
}

function buildNotFound(): Response {
  return HttpResponse.json(
    { message: 'Not Found', documentation_url: 'https://docs.github.com/rest' },
    { status: 404 },
  );
}

function findRepository(params: PathParams) {
  const fullName = `${toParam(params['owner'])}/${toParam(params['name'])}`;

  return githubRepositories.findFirst((query) => query.where({ fullName }));
}

// A repository answers only to the token of its own installation, as GitHub's does.
function findReadableRepository(request: Request, params: PathParams) {
  const repository = findRepository(params);
  const token = request.headers.get('authorization');

  return repository !== undefined && token === `Bearer ghs_test_${repository.installationID}`
    ? repository
    : undefined;
}
