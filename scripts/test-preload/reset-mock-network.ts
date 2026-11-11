import { afterAll, afterEach, beforeAll } from 'bun:test';
import { resetGithubAPI } from '@pepys/source-github/github-api-handlers';
import { mockNetwork } from './mock-network.ts';

beforeAll(async () => {
  await mockNetwork.enable();
});

afterEach(() => {
  mockNetwork.resetHandlers();

  resetGithubAPI();
});

afterAll(async () => {
  await mockNetwork.disable();
});
