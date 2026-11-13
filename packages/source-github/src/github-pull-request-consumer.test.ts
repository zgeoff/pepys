import { expect, onTestFinished, test } from 'bun:test';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { buildQueryContext, createApp } from '@pepys/api';
import type { DeploymentClient } from '@pepys/api';
import { checkDeployment, defineDeployment } from '@pepys/kit';
import type { EntityID } from '@pepys/kit';
import { createTestStore } from '@pepys/testing';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { githubPlugin } from './github-plugin.ts';
import { githubPullRequestConsumer } from './github-pull-request-consumer.ts';
import { githubSource } from './github-source.ts';

async function setupTest() {
  const deployment = defineDeployment({ name: 'harbour', plugins: [githubPlugin] });
  const checked = checkDeployment(deployment);

  invariant(checked.ok, 'the GitHub deployment passes the check');

  const store = await createTestStore({ plugins: [githubPlugin] });

  onTestFinished(() => store[Symbol.asyncDispose]());

  const app = createApp(buildQueryContext(store.reader, checked.value), {
    logError: () => {},
    oauth: null,
  });

  const link = new RPCLink({
    url: '/rpc',
    origin: 'http://pepys.test',

    // RPCLink fixes this option name
    // oxlint-disable-next-line zgeoff/function-verb
    fetch: (url, init) => app.handle(new Request(url, init)),
  });

  const client: DeploymentClient<typeof deployment> = createORPCClient(link);

  return { store, client };
}

test('it declares a consumer that passes the deployment check', () => {
  const checked = checkDeployment({ name: 'harbour', plugins: [githubPlugin] });

  expect(checked.ok).toBe(true);
});

test('it owns the pull request, alias and release bump tables and tails the pull request stream', () => {
  expect(Object.keys(githubPullRequestConsumer.tables)).toStrictEqual([
    'github_pull_request',
    'github_pull_request_alias',
    'github_release_bump',
  ]);

  expect(githubPullRequestConsumer.input).toStrictEqual({
    mode: 'fact',
    streams: ['facts.github.pull_request'],
  });
});

test('it declares the pull request columns', () => {
  expect(githubPullRequestConsumer.tables.github_pull_request.columns).toStrictEqual({
    id: { kind: 'entityID' },
    number: { kind: 'integer' },
    repository_id: { kind: 'entityID' },
    title: { kind: 'text' },
    state: { kind: 'text' },
    is_draft: { kind: 'boolean' },
    is_merged: { kind: 'boolean' },
    author_id: { kind: 'entityID', nullable: true },
    url: { kind: 'text' },
    merge_commit_sha: { kind: 'text', nullable: true },
    created_at: { kind: 'timestamp' },
    updated_at: { kind: 'timestamp' },
    closed_at: { kind: 'timestamp', nullable: true },
    merged_at: { kind: 'timestamp', nullable: true },
    payload: { kind: 'json' },
  });
});

test('it declares an alias table of a text alias key and the entity ID', () => {
  expect(githubPullRequestConsumer.tables.github_pull_request_alias).toStrictEqual({
    columns: { alias: { kind: 'text' }, entity_id: { kind: 'entityID' } },
    primaryKey: ['alias'],
    indexes: [{ columns: ['entity_id'] }],
  });
});

test('it maps the entity view to the title, URL, author and update time', () => {
  expect(githubPullRequestConsumer.entityViews).toStrictEqual([
    {
      table: 'github_pull_request',
      kind: 'github:pull_request',
      id: 'id',
      title: 'title',
      url: 'url',
      actor: 'author_id',
      updatedAt: 'updated_at',
    },
  ]);
});

test('it reads its own pull request and alias tables, to drop an older fact and keep a newer alias holder', () => {
  expect(githubPullRequestConsumer.reads).toStrictEqual([
    'github_pull_request',
    'github_pull_request_alias',
  ]);
});

test.each([
  ['acme/harbour#12'],
  ['Acme/Harbour#12'],
  ['https://github.example/acme/harbour/pull/12'],
  ['https://github.example/Acme/Harbour/pull/12/'],
])('#get_entity returns the pull request that the alias %p names', async (alias) => {
  const ctx = await setupTest();

  await ctx.store.apply(githubSource, [
    {
      type: 'github.pull_request.opened',
      event: 'delivery-1',
      entity: 'github:pull_request:1874433021',
      at: '2026-10-01T09:00:00Z',
      payload: {
        action: 'opened',
        pull_request: {
          id: 1_874_433_021,
          number: 12,
          title: 'Add the harbour map',
          state: 'open',
          html_url: 'https://github.example/Acme/Harbour/pull/12',
          user: { id: 4401 },
          base: { repo: { id: 902 } },
          created_at: '2026-10-01T09:00:00Z',
          updated_at: '2026-10-01T09:00:00Z',
        },
      },
    },
  ]);

  const found = await ctx.client.get_entity({ id: alias });

  expect(found).toStrictEqual({
    entity: {
      id: toTagged<EntityID>('github:pull_request:1874433021'),
      kind: 'github:pull_request',
      title: 'Add the harbour map',
      url: 'https://github.example/Acme/Harbour/pull/12',
      actor: toTagged<EntityID>('github:user:4401'),
      updated_at: '2026-10-01T09:00:00Z',
    },
    consumer: 'github_pull_request',
    table: 'github_pull_request',
    row: expect.objectContaining({ id: 'github:pull_request:1874433021', number: 12 }),
  });
});

test('#get_entity answers NOT_FOUND for an alias of a pull request it has no fact for', async () => {
  const ctx = await setupTest();

  await ctx.store.apply(githubSource, [
    {
      type: 'github.pull_request.opened',
      event: 'delivery-1',
      entity: 'github:pull_request:1874433021',
      at: '2026-10-01T09:00:00Z',
      payload: {
        action: 'opened',
        pull_request: {
          id: 1_874_433_021,
          number: 12,
          title: 'Add the harbour map',
          state: 'open',
          html_url: 'https://github.example/acme/harbour/pull/12',
          base: { repo: { id: 902 } },
          created_at: '2026-10-01T09:00:00Z',
          updated_at: '2026-10-01T09:00:00Z',
        },
      },
    },
  ]);

  const error = await ctx.client.get_entity({ id: 'acme/harbour#13' }).then(
    () => null,
    (error_: unknown) => error_,
  );

  expect(error).toMatchObject({ code: 'NOT_FOUND' });
});
