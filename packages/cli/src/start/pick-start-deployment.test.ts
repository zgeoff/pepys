import { expect, test } from 'bun:test';
import { pickStartDeployment } from './pick-start-deployment.ts';

test('it returns the deployment that the file exports', () => {
  expect(
    pickStartDeployment({ harbourDeployment: { name: 'harbour', plugins: [] } }),
  ).toStrictEqual({
    ok: true,
    value: { name: 'harbour', plugins: [] },
  });
});

test('it refuses a file that exports no deployment', () => {
  expect(pickStartDeployment({ answer: 42 })).toStrictEqual({
    ok: false,
    failure: 'the file exports no Deployment and no Plugin',
  });
});

test('it refuses a file that exports two deployments', () => {
  expect(
    pickStartDeployment({
      first: { name: 'harbour', plugins: [] },
      second: { name: 'quay', plugins: [] },
    }),
  ).toStrictEqual({
    ok: false,
    failure: 'the file exports more than one Deployment or Plugin',
  });
});

test('it refuses a file that exports a plug-in', () => {
  const plugin = { name: 'tides', kit: 1, consumers: [] };

  expect(pickStartDeployment({ plugin })).toStrictEqual({
    ok: false,
    failure: 'the file exports a Plugin, and pepys start runs a Deployment',
  });
});
