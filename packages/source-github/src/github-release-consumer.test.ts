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

test('#get_entity answers NOT_FOUND for a release that GitHub deleted', async () => {
  const ctx = await setupTest();

  const release = {
    id: 5,
    tag_name: 'v1.2.0',
    target_commitish: 'c0ffee1',
    name: 'Harbour 1.2.0',
    html_url: 'https://github.example/acme/harbour/releases/tag/v1.2.0',
    draft: false,
    prerelease: false,
    created_at: '2026-10-01T09:00:00Z',
    published_at: '2026-10-01T09:00:00Z',
  };

  const repository = { id: 902, full_name: 'acme/harbour' };

  await ctx.store.apply(githubSource, [
    {
      type: 'github.release.published',
      event: 'release-1',
      entity: 'github:release:5',
      at: '2026-10-01T09:00:00Z',
      payload: { action: 'published', release, repository },
    },
    {
      type: 'github.release.deleted',
      event: 'release-2',
      entity: 'github:release:5',
      at: '2026-10-01T09:30:00Z',
      payload: { action: 'deleted', release, repository },
    },
  ]);

  const error = await ctx.client.get_entity({ id: 'github:release:5' }).then(
    () => null,
    (error_: unknown) => error_,
  );

  expect(error).toMatchObject({ code: 'NOT_FOUND' });
});

test('#neighbourhood leaves a release that GitHub deleted out of its entities', async () => {
  const ctx = await setupTest();

  const release = {
    id: 5,
    tag_name: 'v1.2.0',
    target_commitish: 'c0ffee1',
    name: 'Harbour 1.2.0',
    html_url: 'https://github.example/acme/harbour/releases/tag/v1.2.0',
    draft: false,
    prerelease: false,
    created_at: '2026-10-01T09:00:00Z',
    published_at: '2026-10-01T09:00:00Z',
  };

  const repository = { id: 902, full_name: 'acme/harbour' };

  await ctx.store.apply(githubSource, [
    {
      type: 'github.release.published',
      event: 'release-1',
      entity: 'github:release:5',
      at: '2026-10-01T09:00:00Z',
      payload: { action: 'published', release, repository },
    },
    {
      type: 'github.release.deleted',
      event: 'release-2',
      entity: 'github:release:5',
      at: '2026-10-01T09:30:00Z',
      payload: { action: 'deleted', release, repository },
    },
  ]);

  const near = await ctx.client.neighbourhood({ id: 'github:release:5' });

  expect(near).toStrictEqual({
    entities: [],
    links: [],
    unresolved: [toTagged<EntityID>('github:release:5')],
    skippedConsumers: [],
    isTruncated: false,
  });
});
