import { expect, test } from 'bun:test';
import invariant from 'tiny-invariant';
import { z } from 'zod';
import { defineConsumer } from '../consumers/define-consumer.ts';
import { defineLinkType } from '../link-types/define-link-type.ts';
import { defineQuery } from '../queries/define-query.ts';
import { defineFactFamily } from '../sources/define-fact-family.ts';
import { defineSource } from '../sources/define-source.ts';
import { receiveFactBatch } from '../sources/receive-fact-batch.ts';
import { defineTable } from '../tables/define-table.ts';
import { buildStubConsumer } from '../test-utils/build-stub-consumer.ts';
import { buildStubQuery } from '../test-utils/build-stub-query.ts';
import { checkDeployment } from './check-deployment.ts';
import { defineDeployment } from './define-deployment.ts';
import { definePlugin } from './define-plugin.ts';
import type { Deployment, DeploymentFailure } from './types.ts';

test('it accepts a deployment and gives what each process works from', () => {
  const tillFamily = defineFactFamily({
    stream: 'facts.ledger.till',
    api: 'ledger/1',
    entityKind: 'ledger:till',
    types: { 'ledger.till.opened': z.object({ clerk: z.string() }) },
  });

  const ledgerSource = defineSource({
    name: 'ledger',
    families: [tillFamily],
    live: receiveFactBatch({
      route: '/ledger/facts',
      check: { kind: 'hmac-sha256', header: 'x-ledger-signature-256', secretEnv: 'LEDGER_SECRET' },
    }),
  });

  const servedBy = defineLinkType({
    name: 'served_by',
    from: ['ledger:till'],
    to: ['roster:clerk'],
    hub: false,
  });

  const tillConsumer = defineConsumer({
    name: 'ledger_till',
    entry: new URL('consumers/ledger-till.ts', import.meta.url),
    input: { mode: 'scope', scopeKind: 'ledger:till', streams: [tillFamily.stream] },
    tables: {
      ledger_till: defineTable({
        columns: {
          id: { kind: 'entityID' },
          clerk_id: { kind: 'entityID' },
          opened_at: { kind: 'timestamp' },
        },
        primaryKey: ['id'],
        indexes: [{ columns: ['clerk_id'] }],
      }),
    },
    entityViews: [
      {
        table: 'ledger_till',
        kind: 'ledger:till',
        id: 'id',
        title: 'id',
        url: null,
        actor: 'clerk_id',
        updatedAt: 'opened_at',
      },
    ],
    reads: [],
    links: [servedBy],
  });

  const tillsSchema = z.array(z.string());

  const openTillsQuery = defineQuery({
    name: 'ledger_open_tills',
    description: 'Lists the tills opened since a time.',
    input: z.object({ since: z.string() }),
    output: z.object({ tills: tillsSchema }),
    reads: [tillConsumer],
    handler: async (call) => {
      const rows = await call.db
        .selectFrom('ledger_till')
        .select('id')
        .where('opened_at', '>=', call.input.since)
        .execute();

      return { tills: rows.map((row) => row.id) };
    },
  });

  const ledgerPlugin = definePlugin({
    name: 'ledger',
    sources: [ledgerSource],
    consumers: [tillConsumer],
    queries: [openTillsQuery],
    settings: {
      schema: z.object({ currency: z.string().length(3) }),
      defaults: { currency: 'NZD' },
    },
  });

  const rosterSource = defineSource({
    name: 'roster',
    families: [
      defineFactFamily({
        stream: 'facts.roster.clerk',
        api: 'roster/1',
        entityKind: 'roster:clerk',
        types: { 'roster.clerk.hired': z.object({}) },
      }),
    ],
  });

  const rosterPlugin = definePlugin({ name: 'roster', sources: [rosterSource] });

  const deployment = defineDeployment({
    name: 'harbour',
    plugins: [ledgerPlugin, rosterPlugin],
    settings: { ledger: { currency: 'AUD' } },
  });

  expect(checkDeployment(deployment)).toStrictEqual({
    ok: true,
    value: {
      name: 'harbour',
      sources: [ledgerSource, rosterSource],
      consumers: [tillConsumer],
      queries: [openTillsQuery],
      entityKinds: ['ledger:till', 'roster:clerk'],
      linkTypes: [servedBy],
      settings: { ledger: { currency: 'AUD' } },
    },
  });
});

test('it refuses a payload field that coerces what ingest stores as sent', () => {
  const counted = z.object({ total: z.coerce.number() });

  const family = defineFactFamily({
    stream: 'facts.ledger.till',
    api: 'ledger/1',
    entityKind: 'ledger:till',
    types: { 'ledger.till.counted': counted },
  });

  const plugin = definePlugin({
    name: 'ledger',
    sources: [defineSource({ name: 'till', families: [family] })],
  });

  expect(checkDeployment({ name: 'harbour', plugins: [plugin] })).toStrictEqual({
    ok: false,
    failure: [
      {
        kind: 'coerced-payload-field',
        source: 'till',
        factType: 'ledger.till.counted',
        field: 'total',
      },
    ],
  });
});

test.each([
  { row: 'a transform', field: z.string().transform((text) => text.length) },
  { row: 'a default', field: z.number().default(0) },
])('it accepts a payload field with $row', (row) => {
  const counted = z.object({ total: row.field });

  const family = defineFactFamily({
    stream: 'facts.ledger.till',
    api: 'ledger/1',
    entityKind: 'ledger:till',
    types: { 'ledger.till.counted': counted },
  });

  const plugin = definePlugin({
    name: 'ledger',
    sources: [defineSource({ name: 'till', families: [family] })],
  });

  const checked = checkDeployment({ name: 'harbour', plugins: [plugin] });

  expect(checked.ok).toBeTrue();
});

test('it fills a setting the deployment leaves out with its default', () => {
  const schema = z.object({ currency: z.string(), roundCents: z.boolean() });

  const deployment = defineDeployment({
    name: 'harbour',
    plugins: [
      definePlugin({
        name: 'ledger',
        settings: { schema, defaults: { currency: 'NZD', roundCents: false } },
      }),
    ],
    settings: { ledger: { roundCents: true } },
  });

  const checked = checkDeployment(deployment);

  invariant(checked.ok);

  expect(checked.value.settings).toStrictEqual({
    ledger: { currency: 'NZD', roundCents: true },
  });
});

test.each<[string, () => Deployment, DeploymentFailure]>([
  [
    'a plug-in of another kit version',
    () => ({ name: 'harbour', plugins: [{ ...definePlugin({ name: 'ledger' }), kit: 2 }] }),
    { kind: 'kit-version', plugin: 'ledger', kit: 2 },
  ],
  [
    'two plug-ins of one name',
    () => ({
      name: 'harbour',
      plugins: [definePlugin({ name: 'ledger' }), definePlugin({ name: 'ledger' })],
    }),
    { kind: 'duplicate', of: 'plugin', name: 'ledger', plugins: ['ledger', 'ledger'] },
  ],
  [
    'two sources of one name',
    () => ({
      name: 'harbour',
      plugins: [
        definePlugin({ name: 'ledger', sources: [defineSource({ name: 'till', families: [] })] }),
        definePlugin({ name: 'roster', sources: [defineSource({ name: 'till', families: [] })] }),
      ],
    }),
    { kind: 'duplicate', of: 'source', name: 'till', plugins: ['ledger', 'roster'] },
  ],
  [
    'two families on one stream',
    () => ({
      name: 'harbour',
      plugins: [
        definePlugin({
          name: 'ledger',
          sources: [
            defineSource({
              name: 'ledger',
              families: [
                defineFactFamily({
                  stream: 'facts.ledger.till',
                  api: 'ledger/1',
                  entityKind: 'ledger:till',
                  types: {},
                }),
                defineFactFamily({
                  stream: 'facts.ledger.till',
                  api: 'ledger/2',
                  entityKind: 'ledger:till',
                  types: {},
                }),
              ],
            }),
          ],
        }),
      ],
    }),
    { kind: 'duplicate', of: 'stream', name: 'facts.ledger.till', plugins: ['ledger', 'ledger'] },
  ],
  [
    'a stored route and an ignored route on one path',
    () => ({
      name: 'harbour',
      plugins: [
        definePlugin({
          name: 'ledger',
          sources: [
            defineSource({
              name: 'ledger',
              families: [],
              live: {
                ...receiveFactBatch({
                  route: '/ledger',
                  check: { kind: 'token', header: 'authorization', secretEnv: 'LEDGER_TOKEN' },
                }),
                ignoredRoutes: ['/ledger'],
              },
            }),
          ],
        }),
      ],
    }),
    { kind: 'duplicate', of: 'route', name: '/ledger', plugins: ['ledger', 'ledger'] },
  ],
  [
    'one fact type in two families',
    () => {
      const opened = z.object({});

      return {
        name: 'harbour',
        plugins: [
          definePlugin({
            name: 'ledger',
            sources: [
              defineSource({
                name: 'ledger',
                families: [
                  defineFactFamily({
                    stream: 'facts.ledger.till',
                    api: 'ledger/1',
                    entityKind: 'ledger:till',
                    types: { 'ledger.opened': opened },
                  }),
                  defineFactFamily({
                    stream: 'facts.ledger.shift',
                    api: 'ledger/1',
                    entityKind: 'ledger:till',
                    types: { 'ledger.opened': opened },
                  }),
                ],
              }),
            ],
          }),
        ],
      };
    },
    { kind: 'duplicate', of: 'fact-type', name: 'ledger.opened', plugins: ['ledger', 'ledger'] },
  ],
  [
    'two consumers of one name',
    () => ({
      name: 'harbour',
      plugins: [
        definePlugin({ name: 'ledger', consumers: [buildStubConsumer({ name: 'ledger_till' })] }),
        definePlugin({ name: 'roster', consumers: [buildStubConsumer({ name: 'ledger_till' })] }),
      ],
    }),
    { kind: 'duplicate', of: 'consumer', name: 'ledger_till', plugins: ['ledger', 'roster'] },
  ],
  [
    'two consumers that declare one table',
    () => ({
      name: 'harbour',
      plugins: [
        definePlugin({
          name: 'ledger',
          consumers: [
            buildStubConsumer({
              name: 'ledger_till',
              tables: {
                till: { columns: { id: { kind: 'entityID' } }, primaryKey: ['id'], indexes: [] },
              },
            }),
            buildStubConsumer({
              name: 'ledger_shift',
              tables: {
                till: { columns: { id: { kind: 'entityID' } }, primaryKey: ['id'], indexes: [] },
              },
            }),
          ],
        }),
      ],
    }),
    { kind: 'duplicate', of: 'table', name: 'till', plugins: ['ledger', 'ledger'] },
  ],
  [
    'two queries of one name',
    () => ({
      name: 'harbour',
      plugins: [
        definePlugin({ name: 'ledger', queries: [buildStubQuery({ name: 'ledger_tills' })] }),
        definePlugin({ name: 'roster', queries: [buildStubQuery({ name: 'ledger_tills' })] }),
      ],
    }),
    { kind: 'duplicate', of: 'query', name: 'ledger_tills', plugins: ['ledger', 'roster'] },
  ],
  [
    'one link type name with two shapes',
    () => ({
      name: 'harbour',
      plugins: [
        definePlugin({
          name: 'ledger',
          consumers: [
            buildStubConsumer({
              name: 'ledger_till',
              entityViews: [],
              links: [
                defineLinkType({
                  name: 'next_to',
                  from: ['ledger:till'],
                  to: ['ledger:till'],
                  hub: false,
                }),
              ],
            }),
          ],
          sources: [
            defineSource({
              name: 'ledger',
              families: [
                defineFactFamily({
                  stream: 'facts.ledger.till',
                  api: 'ledger/1',
                  entityKind: 'ledger:till',
                  types: {},
                }),
              ],
            }),
          ],
        }),
        definePlugin({
          name: 'roster',
          consumers: [
            buildStubConsumer({
              name: 'roster_till',
              links: [
                defineLinkType({
                  name: 'next_to',
                  from: ['ledger:till'],
                  to: ['ledger:till'],
                  hub: true,
                }),
              ],
            }),
          ],
        }),
      ],
    }),
    { kind: 'duplicate', of: 'link-type', name: 'next_to', plugins: ['ledger', 'roster'] },
  ],
  [
    'two entity views of one kind',
    () => ({
      name: 'harbour',
      plugins: [
        definePlugin({
          name: 'ledger',
          consumers: [
            buildStubConsumer({
              name: 'ledger_till',
              tables: {
                till: { columns: { id: { kind: 'entityID' } }, primaryKey: ['id'], indexes: [] },
              },
              entityViews: [
                {
                  table: 'till',
                  kind: 'ledger:till',
                  id: 'id',
                  title: 'id',
                  url: null,
                  actor: null,
                  updatedAt: 'id',
                },
              ],
            }),
            buildStubConsumer({
              name: 'ledger_shift',
              tables: {
                shift: { columns: { id: { kind: 'entityID' } }, primaryKey: ['id'], indexes: [] },
              },
              entityViews: [
                {
                  table: 'shift',
                  kind: 'ledger:till',
                  id: 'id',
                  title: 'id',
                  url: null,
                  actor: null,
                  updatedAt: 'id',
                },
              ],
            }),
          ],
        }),
      ],
    }),
    {
      kind: 'duplicate',
      of: 'entity-view-kind',
      name: 'ledger:till',
      plugins: ['ledger', 'ledger'],
    },
  ],
  [
    'a link end of a kind that no plug-in brings',
    () => ({
      name: 'harbour',
      plugins: [
        definePlugin({
          name: 'ledger',
          sources: [
            defineSource({
              name: 'ledger',
              families: [
                defineFactFamily({
                  stream: 'facts.ledger.till',
                  api: 'ledger/1',
                  entityKind: 'ledger:till',
                  types: {},
                }),
              ],
            }),
          ],
          consumers: [
            buildStubConsumer({
              name: 'ledger_till',
              links: [
                defineLinkType({
                  name: 'served_by',
                  from: ['ledger:till'],
                  to: ['roster:clerk'],
                  hub: false,
                }),
              ],
            }),
          ],
        }),
      ],
    }),
    {
      kind: 'unknown-entity-kind',
      entityKind: 'roster:clerk',
      plugin: 'ledger',
      usedBy: 'served_by',
    },
  ],
  [
    'a query that reads a consumer outside the deployment',
    () => ({
      name: 'harbour',
      plugins: [
        definePlugin({
          name: 'ledger',
          queries: [
            buildStubQuery({
              name: 'ledger_tills',
              reads: [buildStubConsumer({ name: 'ledger_till' })],
            }),
          ],
        }),
      ],
    }),
    { kind: 'missing-consumer', consumer: 'ledger_till', query: 'ledger_tills' },
  ],
  [
    'a consumer of a stream that no family declares',
    () => ({
      name: 'harbour',
      plugins: [
        definePlugin({
          name: 'ledger',
          consumers: [
            buildStubConsumer({
              name: 'ledger_till',
              input: { mode: 'fact', streams: ['facts.ledger.till'] },
            }),
          ],
        }),
      ],
    }),
    { kind: 'missing-stream', stream: 'facts.ledger.till', consumer: 'ledger_till' },
  ],
  [
    'a query named as a core query',
    () => ({
      name: 'harbour',
      plugins: [
        definePlugin({ name: 'ledger', queries: [buildStubQuery({ name: 'get_entity' })] }),
      ],
    }),
    { kind: 'reserved-query-name', query: 'get_entity' },
  ],
  [
    'a table named as a table of the host',
    () => ({
      name: 'harbour',
      plugins: [
        definePlugin({
          name: 'ledger',
          consumers: [
            buildStubConsumer({
              name: 'ledger_till',
              tables: {
                change_log: {
                  columns: { id: { kind: 'entityID' } },
                  primaryKey: ['id'],
                  indexes: [],
                },
              },
            }),
          ],
        }),
      ],
    }),
    { kind: 'reserved-table-name', table: 'change_log', consumer: 'ledger_till' },
  ],
  [
    'a scope consumer that reads a row',
    () => ({
      name: 'harbour',
      plugins: [
        definePlugin({
          name: 'ledger',
          sources: [
            defineSource({
              name: 'ledger',
              families: [
                defineFactFamily({
                  stream: 'facts.ledger.till',
                  api: 'ledger/1',
                  entityKind: 'ledger:till',
                  types: {},
                }),
              ],
            }),
          ],
          consumers: [
            buildStubConsumer({
              name: 'ledger_till',
              input: { mode: 'scope', scopeKind: 'ledger:till', streams: ['facts.ledger.till'] },
              tables: {
                till: { columns: { id: { kind: 'entityID' } }, primaryKey: ['id'], indexes: [] },
              },
              reads: ['till'],
            }),
          ],
        }),
      ],
    }),
    { kind: 'scope-reads', consumer: 'ledger_till' },
  ],
  [
    'a source named as a fact kind',
    () => ({
      name: 'harbour',
      plugins: [
        definePlugin({ name: 'ledger', sources: [defineSource({ name: 'event', families: [] })] }),
      ],
    }),
    { kind: 'reserved-source-name', source: 'event' },
  ],
  [
    'a setting that fails its schema',
    () => ({
      name: 'harbour',
      plugins: [
        definePlugin({
          name: 'ledger',
          settings: { schema: z.object({ currency: z.string() }), defaults: { currency: 'NZD' } },
        }),
      ],
      settings: { ledger: { currency: 7 } },
    }),
    { kind: 'invalid-settings', plugin: 'ledger', issues: [expect.stringContaining('currency')] },
  ],
  [
    'settings for a plug-in that declares none',
    () => ({
      name: 'harbour',
      plugins: [definePlugin({ name: 'ledger' })],
      settings: { ledger: { currency: 'NZD' } },
    }),
    { kind: 'invalid-settings', plugin: 'ledger', issues: ['the plug-in declares no settings'] },
  ],
  [
    'settings for a plug-in outside the deployment',
    () => ({ name: 'harbour', plugins: [], settings: { ledger: { currency: 'NZD' } } }),
    {
      kind: 'invalid-settings',
      plugin: 'ledger',
      issues: ['the deployment has no plug-in of this name'],
    },
  ],
  [
    'a read of a table the consumer does not declare',
    () => ({
      name: 'harbour',
      plugins: [
        definePlugin({
          name: 'ledger',
          consumers: [buildStubConsumer({ name: 'ledger_till', reads: ['till'] })],
        }),
      ],
    }),
    { kind: 'unknown-table', consumer: 'ledger_till', table: 'till', usedBy: 'reads' },
  ],
  [
    'an entity view of a table the consumer does not declare',
    () => ({
      name: 'harbour',
      plugins: [
        definePlugin({
          name: 'ledger',
          consumers: [
            buildStubConsumer({
              name: 'ledger_till',
              entityViews: [
                {
                  table: 'till',
                  kind: 'ledger:till',
                  id: 'id',
                  title: 'id',
                  url: null,
                  actor: null,
                  updatedAt: 'id',
                },
              ],
            }),
          ],
        }),
      ],
    }),
    { kind: 'unknown-table', consumer: 'ledger_till', table: 'till', usedBy: 'entity-view' },
  ],
  [
    'a primary key column the table does not declare',
    () => ({
      name: 'harbour',
      plugins: [
        definePlugin({
          name: 'ledger',
          consumers: [
            buildStubConsumer({
              name: 'ledger_till',
              tables: {
                till: { columns: { id: { kind: 'entityID' } }, primaryKey: ['code'], indexes: [] },
              },
            }),
          ],
        }),
      ],
    }),
    {
      kind: 'unknown-column',
      consumer: 'ledger_till',
      table: 'till',
      column: 'code',
      usedBy: 'primary-key',
    },
  ],
  [
    'a nullable primary key column',
    () => ({
      name: 'harbour',
      plugins: [
        definePlugin({
          name: 'ledger',
          consumers: [
            buildStubConsumer({
              name: 'ledger_till',
              tables: {
                till: {
                  columns: { id: { kind: 'entityID' }, drawer: { kind: 'text', nullable: true } },
                  primaryKey: ['id', 'drawer'],
                  indexes: [],
                },
              },
            }),
          ],
        }),
      ],
    }),
    { kind: 'nullable-key-column', consumer: 'ledger_till', table: 'till', column: 'drawer' },
  ],
  [
    'a row read of a table keyed on a json column',
    () => ({
      name: 'harbour',
      plugins: [
        definePlugin({
          name: 'ledger',
          consumers: [
            buildStubConsumer({
              name: 'ledger_till',
              tables: {
                till: {
                  columns: { float: { kind: 'json' }, note: { kind: 'text' } },
                  primaryKey: ['float'],
                  indexes: [],
                },
              },
              reads: ['till'],
            }),
          ],
        }),
      ],
    }),
    { kind: 'json-key-read', consumer: 'ledger_till', table: 'till', column: 'float' },
  ],
  [
    'an index column the table does not declare',
    () => ({
      name: 'harbour',
      plugins: [
        definePlugin({
          name: 'ledger',
          consumers: [
            buildStubConsumer({
              name: 'ledger_till',
              tables: {
                till: {
                  columns: { id: { kind: 'entityID' } },
                  primaryKey: ['id'],
                  indexes: [{ columns: ['clerk_id'] }],
                },
              },
            }),
          ],
        }),
      ],
    }),
    {
      kind: 'unknown-column',
      consumer: 'ledger_till',
      table: 'till',
      column: 'clerk_id',
      usedBy: 'index',
    },
  ],
  [
    'an entity view column the table does not declare',
    () => ({
      name: 'harbour',
      plugins: [
        definePlugin({
          name: 'ledger',
          consumers: [
            buildStubConsumer({
              name: 'ledger_till',
              tables: {
                till: { columns: { id: { kind: 'entityID' } }, primaryKey: ['id'], indexes: [] },
              },
              entityViews: [
                {
                  table: 'till',
                  kind: 'ledger:till',
                  id: 'id',
                  title: 'label',
                  url: null,
                  actor: null,
                  updatedAt: 'id',
                },
              ],
            }),
          ],
        }),
      ],
    }),
    {
      kind: 'unknown-column',
      consumer: 'ledger_till',
      table: 'till',
      column: 'label',
      usedBy: 'entity-view',
    },
  ],
  [
    'an entity view whose id column is no entity ID',
    () => ({
      name: 'harbour',
      plugins: [
        definePlugin({
          name: 'ledger',
          consumers: [
            buildStubConsumer({
              name: 'ledger_till',
              tables: {
                till: {
                  columns: { code: { kind: 'text' }, label: { kind: 'text' } },
                  primaryKey: ['code'],
                  indexes: [],
                },
              },
              entityViews: [
                {
                  table: 'till',
                  kind: 'ledger:till',
                  id: 'code',
                  title: 'label',
                  url: null,
                  actor: null,
                  updatedAt: 'label',
                },
              ],
            }),
          ],
        }),
      ],
    }),
    {
      kind: 'entity-view-column-kind',
      consumer: 'ledger_till',
      table: 'till',
      view: 'ledger:till',
      column: 'code',
      usedAs: 'id',
    },
  ],
  [
    'an entity view whose actor column is no entity ID',
    () => ({
      name: 'harbour',
      plugins: [
        definePlugin({
          name: 'ledger',
          consumers: [
            buildStubConsumer({
              name: 'ledger_till',
              tables: {
                till: {
                  columns: {
                    id: { kind: 'entityID' },
                    label: { kind: 'text' },
                    clerk: { kind: 'text', nullable: true },
                  },
                  primaryKey: ['id'],
                  indexes: [],
                },
              },
              entityViews: [
                {
                  table: 'till',
                  kind: 'ledger:till',
                  id: 'id',
                  title: 'label',
                  url: null,
                  actor: 'clerk',
                  updatedAt: 'label',
                },
              ],
            }),
          ],
        }),
      ],
    }),
    {
      kind: 'entity-view-column-kind',
      consumer: 'ledger_till',
      table: 'till',
      view: 'ledger:till',
      column: 'clerk',
      usedAs: 'actor',
    },
  ],
  [
    'an entity view whose deletedAt column is no nullable timestamp',
    () => ({
      name: 'harbour',
      plugins: [
        definePlugin({
          name: 'ledger',
          consumers: [
            buildStubConsumer({
              name: 'ledger_till',
              tables: {
                till: {
                  columns: {
                    id: { kind: 'entityID' },
                    label: { kind: 'text' },
                    closed_at: { kind: 'timestamp' },
                  },
                  primaryKey: ['id'],
                  indexes: [],
                },
              },
              entityViews: [
                {
                  table: 'till',
                  kind: 'ledger:till',
                  id: 'id',
                  title: 'label',
                  url: null,
                  actor: null,
                  updatedAt: 'label',
                  deletedAt: 'closed_at',
                },
              ],
            }),
          ],
        }),
      ],
    }),
    {
      kind: 'entity-view-column-kind',
      consumer: 'ledger_till',
      table: 'till',
      view: 'ledger:till',
      column: 'closed_at',
      usedAs: 'deletedAt',
    },
  ],
  [
    'an entity view whose deletedAt column the table lacks',
    () => ({
      name: 'harbour',
      plugins: [
        definePlugin({
          name: 'ledger',
          consumers: [
            buildStubConsumer({
              name: 'ledger_till',
              tables: {
                till: {
                  columns: { id: { kind: 'entityID' }, label: { kind: 'text' } },
                  primaryKey: ['id'],
                  indexes: [],
                },
              },
              entityViews: [
                {
                  table: 'till',
                  kind: 'ledger:till',
                  id: 'id',
                  title: 'label',
                  url: null,
                  actor: null,
                  updatedAt: 'label',
                  deletedAt: 'closed_at',
                },
              ],
            }),
          ],
        }),
      ],
    }),
    {
      kind: 'unknown-column',
      consumer: 'ledger_till',
      table: 'till',
      column: 'closed_at',
      usedBy: 'entity-view',
    },
  ],
])('it refuses %s', (_label, buildDeployment, failure) => {
  expect(checkDeployment(buildDeployment())).toStrictEqual({ ok: false, failure: [failure] });
});

test.each([
  [
    'a column beside alias, entity_id and updated_at',
    {
      columns: {
        alias: { kind: 'text' },
        entity_id: { kind: 'entityID' },
        updated_at: { kind: 'timestamp' },
        added_by: { kind: 'text' },
      },
      primaryKey: ['alias'],
      indexes: [],
    },
  ],
  [
    'a nullable entity_id',
    {
      columns: {
        alias: { kind: 'text' },
        entity_id: { kind: 'entityID', nullable: true },
        updated_at: { kind: 'timestamp' },
      },
      primaryKey: ['alias'],
      indexes: [],
    },
  ],
  [
    'an entity_id of text',
    {
      columns: {
        alias: { kind: 'text' },
        entity_id: { kind: 'text' },
        updated_at: { kind: 'timestamp' },
      },
      primaryKey: ['alias'],
      indexes: [],
    },
  ],
  [
    'no updated_at',
    {
      columns: { alias: { kind: 'text' }, entity_id: { kind: 'entityID' } },
      primaryKey: ['alias'],
      indexes: [],
    },
  ],
  [
    'a nullable updated_at',
    {
      columns: {
        alias: { kind: 'text' },
        entity_id: { kind: 'entityID' },
        updated_at: { kind: 'timestamp', nullable: true },
      },
      primaryKey: ['alias'],
      indexes: [],
    },
  ],
  [
    'an updated_at of text',
    {
      columns: {
        alias: { kind: 'text' },
        entity_id: { kind: 'entityID' },
        updated_at: { kind: 'text' },
      },
      primaryKey: ['alias'],
      indexes: [],
    },
  ],
  [
    'a key of alias and entity_id',
    {
      columns: {
        alias: { kind: 'text' },
        entity_id: { kind: 'entityID' },
        updated_at: { kind: 'timestamp' },
      },
      primaryKey: ['alias', 'entity_id'],
      indexes: [],
    },
  ],
] as const)('it refuses an alias table with %s', (_label, aliasTable) => {
  const deployment = {
    name: 'harbour',
    plugins: [
      definePlugin({
        name: 'ledger',
        consumers: [
          buildStubConsumer({
            name: 'ledger_till',
            tables: {
              till: {
                columns: { id: { kind: 'entityID' }, label: { kind: 'text' } },
                primaryKey: ['id'],
                indexes: [],
              },
              till_alias: aliasTable,
            },
            entityViews: [
              {
                table: 'till',
                kind: 'ledger:till',
                id: 'id',
                title: 'label',
                url: null,
                actor: null,
                updatedAt: 'label',
              },
            ],
          }),
        ],
      }),
    ],
  };

  expect(checkDeployment(deployment)).toStrictEqual({
    ok: false,
    failure: [{ kind: 'alias-table-shape', consumer: 'ledger_till', table: 'till_alias' }],
  });
});

test('it accepts an alias table of a text alias key, an entity ID and an update time', () => {
  const deployment = {
    name: 'harbour',
    plugins: [
      definePlugin({
        name: 'ledger',
        consumers: [
          buildStubConsumer({
            name: 'ledger_till',
            tables: {
              till: {
                columns: { id: { kind: 'entityID' }, label: { kind: 'text' } },
                primaryKey: ['id'],
                indexes: [],
              },
              till_alias: {
                columns: {
                  alias: { kind: 'text' },
                  entity_id: { kind: 'entityID' },
                  updated_at: { kind: 'timestamp' },
                },
                primaryKey: ['alias'],
                indexes: [{ columns: ['entity_id'] }],
              },
            },
            entityViews: [
              {
                table: 'till',
                kind: 'ledger:till',
                id: 'id',
                title: 'label',
                url: null,
                actor: null,
                updatedAt: 'label',
              },
            ],
          }),
        ],
      }),
    ],
  };

  expect(checkDeployment(deployment).ok).toBe(true);
});
