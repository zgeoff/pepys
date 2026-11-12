import { expect, test } from 'bun:test';
import { collectPublicPackages } from './read-public-packages.ts';

test('#collectPublicPackages leaves out a private package', () => {
  const manifests = [
    {
      folder: '/repo/packages/lantern',
      manifest: { name: '@pepys/lantern', private: true, exports: './src/index.ts' },
    },
  ];

  expect(collectPublicPackages(manifests)).toStrictEqual([]);
});

test('#collectPublicPackages gives each subpath of an exports map as an import path', () => {
  const manifests = [
    {
      folder: '/repo/packages/lantern',
      manifest: {
        name: '@pepys/lantern',
        version: '2.1.0',
        exports: { '.': './src/index.ts', './wick': './src/wick.ts' },
      },
    },
  ];

  expect(collectPublicPackages(manifests)).toStrictEqual([
    {
      name: '@pepys/lantern',
      version: '2.1.0',
      folder: '/repo/packages/lantern',
      entries: ['@pepys/lantern', '@pepys/lantern/wick'],
    },
  ]);
});

test('#collectPublicPackages leaves out a subpath pattern, which names no one module', () => {
  const manifests = [
    {
      folder: '/repo/packages/lantern',
      manifest: {
        name: '@pepys/lantern',
        version: '2.1.0',
        exports: { '.': './src/index.ts', './test-utils/*': './src/test-utils/*.ts' },
      },
    },
  ];

  expect(collectPublicPackages(manifests)).toStrictEqual([
    {
      name: '@pepys/lantern',
      version: '2.1.0',
      folder: '/repo/packages/lantern',
      entries: ['@pepys/lantern'],
    },
  ]);
});

test('#collectPublicPackages gives a package with one export its name as the import path', () => {
  const manifests = [
    {
      folder: '/repo/packages/lantern',
      manifest: { name: '@pepys/lantern', version: '2.1.0', exports: './src/index.ts' },
    },
  ];

  expect(collectPublicPackages(manifests)).toStrictEqual([
    {
      name: '@pepys/lantern',
      version: '2.1.0',
      folder: '/repo/packages/lantern',
      entries: ['@pepys/lantern'],
    },
  ]);
});

test('#collectPublicPackages throws on a public package with no version', () => {
  const manifests = [
    {
      folder: '/repo/packages/lantern',
      manifest: { name: '@pepys/lantern', exports: './src/index.ts' },
    },
  ];

  expect(() => collectPublicPackages(manifests)).toThrowWithMessage(
    Error,
    /lacks a name or a version/u,
  );
});
