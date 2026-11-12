import { expect, test } from 'bun:test';

test('it answers 500 to a request to a remote host that no handler matches', async () => {
  const response = await fetch('https://unmatched.example/anything');

  expect(response.status).toBe(500);
});
