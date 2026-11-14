import { expect, test } from 'bun:test';
import { createLogger } from '@pepys/kit';
import { mockNetwork } from '@pepys/mock-network';
import { HttpResponse, http } from 'msw';
import { GITHUB_API_URL } from '../../test-utils/github-api-handlers.ts';
import { readInstallationToken } from './read-installation-token.ts';

test('it creates the token with a JWT signed after the installation answer', async () => {
  const signed: string[] = [];

  mockNetwork.use(
    http.get(`${GITHUB_API_URL}/repos/acme/harbour/installation`, () =>
      HttpResponse.json({ id: 31 }),
    ),
    http.post(`${GITHUB_API_URL}/app/installations/31/access_tokens`, (info) =>
      info.request.headers.get('authorization') === 'Bearer jwt-2'
        ? HttpResponse.json({ token: 'ghs_quay' }, { status: 201 })
        : HttpResponse.json({ message: 'Bad credentials' }, { status: 401 }),
    ),
  );

  const token = await readInstallationToken(
    'acme/harbour',
    () => {
      signed.push(`jwt-${signed.length + 1}`);

      return signed.at(-1) ?? '';
    },
    { log: createLogger({ write: () => {} }), signal: new AbortController().signal },
  );

  expect(token).toStrictEqual({ kind: 'token', token: 'ghs_quay' });
});
