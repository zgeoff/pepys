import { expect, test } from 'bun:test';
import { buildOutsideProject } from './build-outside-project.ts';

test('it installs each package from its tarball and overrides the version that npm lacks', () => {
  const files = buildOutsideProject({
    packages: [
      {
        name: '@pepys/lantern',
        version: '2.1.0',
        folder: '/repo/packages/lantern',
        entries: ['@pepys/lantern'],
      },
    ],
    source: { kind: 'tarballs', tarballs: { '@pepys/lantern': '/packs/pepys-lantern-2.1.0.tgz' } },
    catalog: { '@zgeoff/std': '0.4.3', zod: '4.6.7', '@types/bun': '1.4.4', typescript: '7.0.2' },
    releaseAgeExcludes: [],
  });

  const manifest: unknown = JSON.parse(files['package.json'] ?? '');

  expect(manifest).toStrictEqual({
    name: 'pepys-outside-check',
    private: true,
    type: 'module',
    dependencies: {
      '@pepys/lantern': 'file:/packs/pepys-lantern-2.1.0.tgz',
      '@zgeoff/std': '0.4.3',
      zod: '4.6.7',
    },
    devDependencies: { '@types/bun': '1.4.4', typescript: '7.0.2' },
    trustedDependencies: ['scriptc'],
    overrides: { '@pepys/lantern': 'file:/packs/pepys-lantern-2.1.0.tgz' },
  });
});

test('it installs each package from npm at one version with no override', () => {
  const files = buildOutsideProject({
    packages: [
      {
        name: '@pepys/lantern',
        version: '2.1.0',
        folder: '/repo/packages/lantern',
        entries: ['@pepys/lantern'],
      },
    ],
    source: { kind: 'npm', version: '2.1.0' },
    catalog: { '@zgeoff/std': '0.4.3', zod: '4.6.7', '@types/bun': '1.4.4', typescript: '7.0.2' },
    releaseAgeExcludes: [],
  });

  const manifest: unknown = JSON.parse(files['package.json'] ?? '');

  expect(manifest).toStrictEqual({
    name: 'pepys-outside-check',
    private: true,
    type: 'module',
    dependencies: { '@pepys/lantern': '2.1.0', '@zgeoff/std': '0.4.3', zod: '4.6.7' },
    devDependencies: { '@types/bun': '1.4.4', typescript: '7.0.2' },
    trustedDependencies: ['scriptc'],
  });
});

test('it isolates the install and lets the public packages and each package the repo excludes past the release-age gate', () => {
  const files = buildOutsideProject({
    packages: [
      {
        name: '@pepys/lantern',
        version: '2.1.0',
        folder: '/repo/packages/lantern',
        entries: ['@pepys/lantern'],
      },
    ],
    source: { kind: 'npm', version: '2.1.0' },
    catalog: { '@zgeoff/std': '0.4.3', zod: '4.6.7', '@types/bun': '1.4.4', typescript: '7.0.2' },
    releaseAgeExcludes: ['@zgeoff/std', '@orpc/server'],
  });

  expect(files['bunfig.toml']).toBe(
    '[install]\nlinker = "isolated"\nminimumReleaseAge = 604800\nminimumReleaseAgeExcludes = [\n  "@pepys/lantern",\n  "@zgeoff/std",\n  "@orpc/server",\n]\n',
  );
});

test('it imports every entry of every package in the entries test', () => {
  const files = buildOutsideProject({
    packages: [
      {
        name: '@pepys/lantern',
        version: '2.1.0',
        folder: '/repo/packages/lantern',
        entries: ['@pepys/lantern', '@pepys/lantern/wick'],
      },
    ],
    source: { kind: 'npm', version: '2.1.0' },
    catalog: { '@zgeoff/std': '0.4.3', zod: '4.6.7', '@types/bun': '1.4.4', typescript: '7.0.2' },
    releaseAgeExcludes: [],
  });

  expect(files['src/entries.test.ts']).toIncludeMultiple([
    "import * as entry0 from '@pepys/lantern';",
    "import * as entry1 from '@pepys/lantern/wick';",
  ]);
});

test('it throws when the catalog lacks a pin the project needs', () => {
  expect(() =>
    buildOutsideProject({
      packages: [
        {
          name: '@pepys/lantern',
          version: '2.1.0',
          folder: '/repo/packages/lantern',
          entries: ['@pepys/lantern'],
        },
      ],
      source: { kind: 'npm', version: '2.1.0' },
      catalog: { zod: '4.6.7' },
      releaseAgeExcludes: [],
    }),
  ).toThrowWithMessage(Error, /no pin for @zgeoff\/std/u);
});
