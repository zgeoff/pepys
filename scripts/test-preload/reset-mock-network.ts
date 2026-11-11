import { afterAll, afterEach, beforeAll } from 'bun:test';
import { resetGithubAPI } from '../../packages/source-github/src/test-utils/github-api-handlers.ts';
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
