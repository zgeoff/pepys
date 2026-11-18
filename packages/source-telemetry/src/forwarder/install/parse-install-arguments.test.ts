import { expect, test } from 'bun:test';
import { parseInstallArguments } from './parse-install-arguments.ts';

test('#parseInstallArguments reads the three flags and drops a trailing slash', () => {
  const parsed = parseInstallArguments([
    '--issuer',
    'study-pc',
    '--audience',
    'forwarder.pepys.example',
    '--ingest-url',
    'https://ingest.tailnet.example/',
  ]);

  expect(parsed).toStrictEqual({
    ok: true,
    value: {
      issuer: 'study-pc',
      audience: 'forwarder.pepys.example',
      ingestURL: 'https://ingest.tailnet.example',
    },
  });
});

test('#parseInstallArguments leaves the ingest URL out when no flag gives one', () => {
  const parsed = parseInstallArguments(['--issuer', 'a', '--audience', 'b']);

  expect(parsed).toStrictEqual({
    ok: true,
    value: { issuer: 'a', audience: 'b', ingestURL: null },
  });
});

test.each([
  ['no issuer', ['--audience', 'b']],
  ['no audience', ['--issuer', 'a']],
  ['an issuer with a space', ['--issuer', 'a b', '--audience', 'b']],
  ['an issuer of 129 characters', ['--issuer', 'a'.repeat(129), '--audience', 'b']],
  ['an empty issuer', ['--issuer', '', '--audience', 'b']],
  ['an audience with a line break', ['--issuer', 'a', '--audience', 'b\nExecStart=x']],
  ['an unknown flag', ['--issuer', 'a', '--audience', 'b', '--force']],
  ['an http ingest URL', ['--issuer', 'a', '--audience', 'b', '--ingest-url', 'http://i.example']],
  [
    'an ingest URL with a path',
    ['--issuer', 'a', '--audience', 'b', '--ingest-url', 'https://i.example/api'],
  ],
  ['an ingest URL that is no URL', ['--issuer', 'a', '--audience', 'b', '--ingest-url', 'nope']],
])('#parseInstallArguments fails on %s', (_name, argv) => {
  expect(parseInstallArguments(argv).ok).toBeFalse();
});
