import { expect, test } from 'bun:test';

test('it answers a request that a GitHub API handler matches', async () => {
  const response = await fetch('https://api.github.com/app/hook/deliveries');

  expect(response.status).toBe(401);
});
