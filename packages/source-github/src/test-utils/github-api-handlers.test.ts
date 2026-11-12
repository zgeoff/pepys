import { expect, test } from 'bun:test';
import {
  GITHUB_API_URL,
  githubDeliveries,
  githubPullRequests,
  githubReleases,
  githubRepositories,
  resetGithubAPI,
} from './github-api-handlers.ts';

test('it lists the deliveries newest first, two to a page, with a link to the next page', async () => {
  const appJWT = `head.${Buffer.from('{"iss":"4242"}').toString('base64url')}.signature`;

  await githubDeliveries.create({ id: '9007199254740993', guid: 'g-3' });
  await githubDeliveries.create({ id: '9007199254740991', guid: 'g-1' });
  await githubDeliveries.create({ id: '9007199254740992', guid: 'g-2', statusCode: 502 });

  const first = await fetch(`${GITHUB_API_URL}/app/hook/deliveries`, {
    headers: { authorization: `Bearer ${appJWT}` },
  });

  const firstPage = { link: first.headers.get('link'), text: await first.text() };

  expect(firstPage).toStrictEqual({
    link: `<${GITHUB_API_URL}/app/hook/deliveries?cursor=2>; rel="next"`,
    text: expect.stringMatching(
      /^\[\{"id":9007199254740993,"guid":"g-3",.*"status":"OK".*\},\{"id":9007199254740992,"guid":"g-2",.*"status":"Invalid HTTP Response: 502","status_code":502,.*\}\]$/u,
    ),
  });
});

test('it gives the last page of deliveries no link', async () => {
  const appJWT = `head.${Buffer.from('{"iss":"4242"}').toString('base64url')}.signature`;

  await githubDeliveries.create({ id: '41', guid: 'g-41' });
  await githubDeliveries.create({ id: '42', guid: 'g-42' });
  await githubDeliveries.create({ id: '43', guid: 'g-43' });

  const last = await fetch(`${GITHUB_API_URL}/app/hook/deliveries?cursor=2`, {
    headers: { authorization: `Bearer ${appJWT}` },
  });

  const lastPage = { link: last.headers.get('link'), body: await last.json() };

  expect(lastPage).toStrictEqual({
    link: null,
    body: [expect.objectContaining({ id: 41, guid: 'g-41' })],
  });
});

test('it answers one delivery with the event and payload of its request', async () => {
  const appJWT = `head.${Buffer.from('{"iss":"4242"}').toString('base64url')}.signature`;

  await githubDeliveries.create({
    id: '77',
    guid: 'g-77',
    event: 'release',
    payload: { action: 'published', release: { id: 8 } },
  });

  const answered = await fetch(`${GITHUB_API_URL}/app/hook/deliveries/77`, {
    headers: { authorization: `Bearer ${appJWT}` },
  });

  const answer: unknown = await answered.json();

  expect(answer).toStrictEqual({
    id: 77,
    guid: 'g-77',
    delivered_at: '2026-10-01T09:00:00Z',
    redelivery: false,
    duration: 0.2,
    status: 'OK',
    status_code: 200,
    event: 'release',
    action: null,
    installation_id: 31,
    repository_id: 902,
    url: '',
    request: {
      headers: { 'X-GitHub-Event': 'release' },
      payload: { action: 'published', release: { id: 8 } },
    },
    response: { headers: {}, payload: null },
  });
});

test('it answers 404 for a delivery it does not hold', async () => {
  const appJWT = `head.${Buffer.from('{"iss":"4242"}').toString('base64url')}.signature`;

  const answered = await fetch(`${GITHUB_API_URL}/app/hook/deliveries/78`, {
    headers: { authorization: `Bearer ${appJWT}` },
  });

  expect(answered.status).toBe(404);
});

test.each([
  ['GET', '/app/hook/deliveries', 'no token', {}],
  ['GET', '/app/hook/deliveries/77', 'no token', {}],
  ['POST', '/app/installations/31/access_tokens', 'no token', {}],
  ['GET', '/repos/acme/harbour/installation', 'no token', {}],
  ['GET', '/app/hook/deliveries', 'a token that is no JWT', { authorization: 'Bearer not-a-jwt' }],
  [
    'GET',
    '/app/hook/deliveries',
    'a JWT with no issuer',
    {
      authorization: `Bearer head.${Buffer.from('{"sub":"4242"}').toString('base64url')}.signature`,
    },
  ],
])('it answers 401 to %s %s with %s', async (method, path, _label, headers) => {
  await githubRepositories.create({ id: 902, fullName: 'acme/harbour', installationID: 31 });
  await githubDeliveries.create({ id: '77' });

  const answered = await fetch(`${GITHUB_API_URL}${path}`, { method, headers });

  expect(answered.status).toBe(401);
});

test('it gives an installation an access token named after it', async () => {
  const appJWT = `head.${Buffer.from('{"iss":"4242"}').toString('base64url')}.signature`;

  const answered = await fetch(`${GITHUB_API_URL}/app/installations/58/access_tokens`, {
    method: 'POST',
    headers: { authorization: `Bearer ${appJWT}` },
  });

  const granted = { status: answered.status, body: await answered.json() };

  expect(granted).toStrictEqual({
    status: 201,
    body: { token: 'ghs_test_58', expires_at: '2099-01-01T00:00:00Z' },
  });
});

test('it names the installation of a repository it holds', async () => {
  const appJWT = `head.${Buffer.from('{"iss":"4242"}').toString('base64url')}.signature`;

  await githubRepositories.create({ id: 903, fullName: 'acme/beacon', installationID: 58 });

  const answered = await fetch(`${GITHUB_API_URL}/repos/acme/beacon/installation`, {
    headers: { authorization: `Bearer ${appJWT}` },
  });

  const answer: unknown = await answered.json();

  expect(answer).toStrictEqual({ id: 58, app_id: 1 });
});

test('it answers 404 for the installation of a repository it does not hold', async () => {
  const appJWT = `head.${Buffer.from('{"iss":"4242"}').toString('base64url')}.signature`;

  const answered = await fetch(`${GITHUB_API_URL}/repos/acme/beacon/installation`, {
    headers: { authorization: `Bearer ${appJWT}` },
  });

  expect(answered.status).toBe(404);
});

test.each([
  ['/repos/acme/beacon', { id: 903, full_name: 'acme/beacon', pushed_at: '2026-10-01T09:00:00Z' }],
  ['/repos/acme/beacon/pulls/6', { number: 6, title: 'Light the beacon' }],
  ['/repos/acme/beacon/releases/9', { id: 9, tag_name: 'v0.4.0' }],
])('it answers %s to the token of the repository installation', async (path, body) => {
  await githubRepositories.create({ id: 903, fullName: 'acme/beacon', installationID: 58 });

  await githubPullRequests.create({
    repository: 'acme/beacon',
    number: 6,
    record: { number: 6, title: 'Light the beacon' },
  });

  await githubReleases.create({
    repository: 'acme/beacon',
    id: 9,
    record: { id: 9, tag_name: 'v0.4.0' },
  });

  const answered = await fetch(`${GITHUB_API_URL}${path}`, {
    headers: { authorization: 'Bearer ghs_test_58' },
  });

  const answer: unknown = await answered.json();

  expect(answer).toStrictEqual(body);
});

test.each([
  ['/repos/acme/beacon'],
  ['/repos/acme/beacon/pulls/6'],
  ['/repos/acme/beacon/releases/9'],
])('it answers 404 to %s with the token of another installation', async (path) => {
  await githubRepositories.create({ id: 903, fullName: 'acme/beacon', installationID: 58 });
  await githubPullRequests.create({ repository: 'acme/beacon', number: 6, record: { number: 6 } });
  await githubReleases.create({ repository: 'acme/beacon', id: 9, record: { id: 9 } });

  const answered = await fetch(`${GITHUB_API_URL}${path}`, {
    headers: { authorization: 'Bearer ghs_test_31' },
  });

  expect(answered.status).toBe(404);
});

test.each([['/repos/acme/beacon/pulls/7'], ['/repos/acme/beacon/releases/10']])(
  'it answers 404 to %s, which the repository does not hold',
  async (path) => {
    await githubRepositories.create({ id: 903, fullName: 'acme/beacon', installationID: 58 });

    const answered = await fetch(`${GITHUB_API_URL}${path}`, {
      headers: { authorization: 'Bearer ghs_test_58' },
    });

    expect(answered.status).toBe(404);
  },
);

test('#resetGithubAPI clears every collection', async () => {
  await githubRepositories.create({ id: 903, fullName: 'acme/beacon', installationID: 58 });
  await githubPullRequests.create({ repository: 'acme/beacon', number: 6 });
  await githubReleases.create({ repository: 'acme/beacon', id: 9 });
  await githubDeliveries.create({ id: '77' });

  resetGithubAPI();

  expect([
    githubRepositories.all(),
    githubPullRequests.all(),
    githubReleases.all(),
    githubDeliveries.all(),
  ]).toStrictEqual([[], [], [], []]);
});
