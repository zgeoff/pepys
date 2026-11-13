import { expect, test } from 'bun:test';
import { renderConsentPage } from './render-consent-page.ts';

test('it escapes a client name that carries markup', () => {
  const page = renderConsentPage({
    oauthQuery: 'q=1',
    clientName: '<script>alert(1)</script>',
    redirectURI: 'https://dots.example/cb',
    scopes: ['read'],
  });

  expect(page).not.toInclude('<script>alert(1)</script>');
  expect(page).toInclude('&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('it escapes the signed query it posts back', () => {
  const page = renderConsentPage({
    oauthQuery: 'a="><b>',
    clientName: 'dots',
    redirectURI: 'https://dots.example/cb',
    scopes: ['read'],
  });

  expect(page).toInclude('name="oauth_query" value="a=&quot;&gt;&lt;b&gt;"');
});

test('it starts with read granted, described as reading the deployment', () => {
  const page = renderConsentPage({
    oauthQuery: 'q=1',
    clientName: 'dots',
    redirectURI: 'https://dots.example/cb',
    scopes: ['read'],
  });

  expect(page).toInclude(
    'value="read" checked> Read your entities, their links, and every query the deployment serves',
  );
});
