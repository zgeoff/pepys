import { expect, test } from 'bun:test';

test('it answers 500 to a request to a remote host that no handler matches', async () => {
  const response = await fetch('https://unmatched.example/anything');

  expect(response.status).toBe(500);
});

test('it answers a request that a GitHub API handler matches', async () => {
  const response = await fetch('https://api.github.com/app/hook/deliveries');

  expect(response.status).toBe(401);
});
