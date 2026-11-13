import { expect, test } from 'bun:test';
import { toTagged } from '@zgeoff/std';
import type { OAuthClientID, OAuthGrantID, PasskeyID } from '../oauth/auth/types.ts';
import { parseAPIArguments } from './parse-api-arguments.ts';
import type { APICommand } from './parse-api-arguments.ts';

test.each<[readonly string[], APICommand]>([
  [[], { kind: 'serve' }],
  [['passkeys'], { kind: 'passkeys', action: { kind: 'list' } }],
  [['passkeys', 'list'], { kind: 'passkeys', action: { kind: 'list' } }],
  [['passkeys', 'enroll'], { kind: 'passkeys', action: { kind: 'enroll', reset: false } }],
  [
    ['passkeys', 'enroll', '--reset'],
    { kind: 'passkeys', action: { kind: 'enroll', reset: true } },
  ],
  [
    ['passkeys', 'remove', 'key-1'],
    { kind: 'passkeys', action: { kind: 'remove', id: toTagged<PasskeyID>('key-1') } },
  ],
  [['clients'], { kind: 'clients', action: { kind: 'list' } }],
  [
    [
      'clients',
      'add',
      'harbour assistant',
      '--redirect-uri',
      'https://assistant.example.com/callback',
      '--redirect-uri',
      'https://assistant.example.com/other',
    ],
    {
      kind: 'clients',
      action: {
        kind: 'add',
        name: 'harbour assistant',
        redirectURIs: [
          'https://assistant.example.com/callback',
          'https://assistant.example.com/other',
        ],
      },
    },
  ],
  [
    ['clients', 'remove', 'client-1'],
    {
      kind: 'clients',
      action: { kind: 'remove', clientID: toTagged<OAuthClientID>('client-1') },
    },
  ],
  [['grants'], { kind: 'grants', revoke: null }],
  [['grants', '--revoke=grant-1'], { kind: 'grants', revoke: toTagged<OAuthGrantID>('grant-1') }],
])('it parses %p', (args, command) => {
  expect(parseAPIArguments(args)).toStrictEqual({ ok: true, value: command });
});

test.each([
  [['serve', 'now']],
  [['passkeys', 'list', '--reset']],
  [['passkeys', 'remove']],
  [['passkeys', 'remove', 'key-1', 'key-2']],
  [['clients', 'add']],
  [['clients', 'list', '--redirect-uri', 'https://assistant.example.com/callback']],
  [['clients', 'remove', 'client-1', '--redirect-uri', 'https://assistant.example.com/callback']],
  [['grants', 'extra']],
  [['grants', '--unknown']],
])('it refuses %p with the usage', (args) => {
  expect(parseAPIArguments(args)).toStrictEqual({
    ok: false,
    failure: expect.stringContaining('usage: <entry>'),
  });
});
