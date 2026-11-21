import { afterEach, beforeEach } from 'bun:test';
import { mockNetwork } from '@pepys/mock-network';
import { githubAPIHandlers, resetGithubAPI } from './github-api-handlers.ts';

// The mock network's handlers last for one test, so each test starts with the GitHub API ones.
// A handler a test adds later answers first.
beforeEach(() => {
  mockNetwork.use(...githubAPIHandlers);
});

afterEach(() => {
  resetGithubAPI();
});
