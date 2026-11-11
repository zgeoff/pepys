import { githubAPIURL } from './github-api-url.ts';

// One answer of the GitHub REST API. `next` is the URL of the next page, from the `link` header.
export interface GithubAnswer {
  status: number;
  body: unknown;
  next: string | undefined;
}

// One call to the GitHub REST API, with a path or a whole URL from a `link` header. A transport
// failure answers status 0.
export async function requestGithubAPI(
  pathOrURL: string,
  token: string,
  method: 'GET' | 'POST' = 'GET',
): Promise<GithubAnswer> {
  const url = pathOrURL.startsWith('/') ? `${githubAPIURL}${pathOrURL}` : pathOrURL;

  const response = await sendRequest(url, token, method);

  if (response === undefined) {
    return { status: 0, body: undefined, next: undefined };
  }

  const text = await response.text();

  return {
    status: response.status,
    body: parseBody(text),
    next: findNextPage(response.headers.get('link')),
  };
}

async function sendRequest(
  url: string,
  token: string,
  method: 'GET' | 'POST',
): Promise<Response | undefined> {
  try {
    const response = await fetch(url, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'pepys-ingest',
        'x-github-api-version': '2022-11-28',
      },
    });

    return response;
  } catch (error: unknown) {
    console.error(`a GitHub API call to ${url} failed`, error);

    return undefined;
  }
}

function parseBody(text: string): unknown {
  try {
    const body: unknown = JSON.parse(text);

    return body;
  } catch {
    return undefined;
  }
}

function findNextPage(link: string | null): string | undefined {
  const next = link
    ?.split(',')
    .map((part) => /<(?<url>[^>]+)>;\s*rel="next"/u.exec(part.trim()))
    .find((found) => found !== null);

  return next?.groups?.['url'];
}
