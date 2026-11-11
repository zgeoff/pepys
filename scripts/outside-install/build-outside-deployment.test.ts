import { expect, test } from 'bun:test';
import { buildOutsideDeployment } from './build-outside-deployment.ts';

test('it adds a deployment of the stub plug-in and a consumer entry that reads its glue', () => {
  const files = buildOutsideDeployment({
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

  expect({
    deployment: files['src/deployment.ts'],
    entry: files['src/consumers/shelf-book.ts'],
  }).toStrictEqual({
    deployment: expect.stringContaining(
      "defineDeployment({ name: 'shelf', plugins: [shelfPlugin] })",
    ),
    entry: expect.stringContaining("from '../generated/shelf-book-boundary.ts'"),
  });
});
