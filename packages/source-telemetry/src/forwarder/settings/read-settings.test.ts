import { expect, test } from 'bun:test';
import { resolveSettings } from './read-settings.ts';

test('#resolveSettings gives the defaults and no send loop for an empty environment', () => {
  expect(resolveSettings({}, '/home/owner')).toStrictEqual({
    ok: true,
    value: {
      host: '127.0.0.1',
      port: 4318,
      spoolDir: '/home/owner/.local/state/pepys-telemetry-forwarder',
      identityDir: '/home/owner/.config/pepys-telemetry-forwarder',
      send: null,
    },
  });
});

test('#resolveSettings reads every variable and drops a trailing slash of the ingest URL', () => {
  const settings = resolveSettings(
    {
      PEPYS_FORWARDER_HOST: '0.0.0.0',
      PEPYS_FORWARDER_PORT: '4999',
      PEPYS_FORWARDER_SPOOL_DIR: '/var/spool',
      PEPYS_FORWARDER_IDENTITY_DIR: '/etc/identity',
      PEPYS_FORWARDER_INGEST_URL: 'https://ingest.tailnet.example/',
      PEPYS_FORWARDER_ISSUER: 'study-pc',
      PEPYS_FORWARDER_AUDIENCE: 'forwarder.pepys.example',
      PEPYS_FORWARDER_MAX_BYTES_PER_SECOND: '50000',
    },
    '/home/owner',
  );

  expect(settings).toStrictEqual({
    ok: true,
    value: {
      host: '0.0.0.0',
      port: 4999,
      spoolDir: '/var/spool',
      identityDir: '/etc/identity',
      send: {
        ingestURL: 'https://ingest.tailnet.example',
        issuer: 'study-pc',
        audience: 'forwarder.pepys.example',
        maxBytesPerSecond: 50_000,
      },
    },
  });
});

test('#resolveSettings runs the receiver alone, with no ingest URL, whatever the issuer and audience hold', () => {
  const settings = resolveSettings({ PEPYS_FORWARDER_ISSUER: 'study-pc' }, '/home/owner');

  expect(settings.ok && settings.value.send).toBeNull();
});

test.each([
  ['an issuer', { PEPYS_FORWARDER_AUDIENCE: 'a' }],
  ['an audience', { PEPYS_FORWARDER_ISSUER: 'a' }],
])('#resolveSettings fails with an ingest URL and no %s', (_name, extra) => {
  const settings = resolveSettings(
    { PEPYS_FORWARDER_INGEST_URL: 'https://ingest.tailnet.example', ...extra },
    '/home/owner',
  );

  expect(settings.ok).toBeFalse();
});

test.each(['abc', '-1', '70000', '1.5'])('#resolveSettings fails on the port %p', (port) => {
  expect(resolveSettings({ PEPYS_FORWARDER_PORT: port }, '/home/owner').ok).toBeFalse();
});

test('#resolveSettings caps the send rate at 128 KiB a second when no rate is set', () => {
  const settings = resolveSettings(
    {
      PEPYS_FORWARDER_INGEST_URL: 'https://ingest.tailnet.example',
      PEPYS_FORWARDER_ISSUER: 'study-pc',
      PEPYS_FORWARDER_AUDIENCE: 'forwarder.pepys.example',
    },
    '/home/owner',
  );

  expect(settings.ok && settings.value.send?.maxBytesPerSecond).toBe(131_072);
});

test.each(['0', '-5', '1.5', '10k', '9007199254740993'])(
  '#resolveSettings fails on the send rate %s',
  (rate) => {
    const settings = resolveSettings(
      {
        PEPYS_FORWARDER_INGEST_URL: 'https://ingest.tailnet.example',
        PEPYS_FORWARDER_ISSUER: 'study-pc',
        PEPYS_FORWARDER_AUDIENCE: 'forwarder.pepys.example',
        PEPYS_FORWARDER_MAX_BYTES_PER_SECOND: rate,
      },
      '/home/owner',
    );

    expect(settings).toStrictEqual({
      ok: false,
      failure: 'PEPYS_FORWARDER_MAX_BYTES_PER_SECOND must be a whole number above 0',
    });
  },
);
