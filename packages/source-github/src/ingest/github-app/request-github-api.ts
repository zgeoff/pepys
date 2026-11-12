import type { Logger } from '@pepys/kit';
import { githubAPIURL } from './github-api-url.ts';

// One answer of the GitHub REST API. `text` is the body as sent, for a caller that must read a
// number above 2^53 exactly. `next` is the URL of the next page, from the `link` header.
export interface GithubAnswer {
  status: number;
  text: string;
  body: unknown;
  next: string | undefined;
}

// What each call needs from the pull that makes it: the logger, and the signal that aborts the call
// when ingest stops.
export interface GithubCall {
  log: Logger;
  signal: AbortSignal;
}

// One call to the GitHub REST API, with a path or a whole URL from a `link` header. A transport
// failure, an aborted call included, answers status 0.
export async function requestGithubAPI(
  pathOrURL: string,
  token: string,
  call: GithubCall,
  method: 'GET' | 'POST' = 'GET',
): Promise<GithubAnswer> {
  const url = pathOrURL.startsWith('/') ? `${githubAPIURL}${pathOrURL}` : pathOrURL;

  const response = await sendRequest(url, token, method, call);

  if (response === undefined) {
    return { status: 0, text: '', body: undefined, next: undefined };
  }

  return {
    status: response.status,
    text: response.text,
    body: parseBody(response.text),
    next: findNextPage(response.headers.get('link')),
  };
}

interface SentRequest {
  status: number;
  text: string;
  headers: Headers;
}

// The body is read inside the `try`, so an abort while GitHub still sends it counts as a failed call.
async function sendRequest(
  url: string,
  token: string,
  method: 'GET' | 'POST',
  call: GithubCall,
): Promise<SentRequest | undefined> {
  try {
    const response = await fetch(url, {
      method,
      signal: call.signal,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'pepys-ingest',
        'x-github-api-version': '2022-11-28',
      },
    });

    const text = await response.text();

    return { status: response.status, text, headers: response.headers };
  } catch (error: unknown) {
    // a call that ingest's stop aborted is no failure
    if (!call.signal.aborted) {
      call.log.error(`a GitHub API call to ${url} failed`, error);
    }

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
