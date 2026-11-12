import { afterAll, afterEach, beforeAll } from 'bun:test';
import { mockNetwork } from '@pepys/mock-network';
import { githubAPIHandlers, resetGithubAPI } from './github-api-handlers.ts';

// `resetHandlers` with handlers makes them the ones each later reset keeps.
beforeAll(() => {
  mockNetwork.resetHandlers(...githubAPIHandlers);
  mockNetwork.enable();
});

afterEach(() => {
  mockNetwork.resetHandlers(...githubAPIHandlers);

  resetGithubAPI();
});

afterAll(() => {
  mockNetwork.disable();
});
