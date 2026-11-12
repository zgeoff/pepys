import { afterAll, afterEach, beforeAll } from 'bun:test';
import { resetGithubAPI } from './github-api-handlers.ts';
import { mockNetwork } from './mock-network.ts';

beforeAll(() => {
  mockNetwork.enable();
});

afterEach(() => {
  mockNetwork.resetHandlers();

  resetGithubAPI();
});

afterAll(() => {
  mockNetwork.disable();
});
