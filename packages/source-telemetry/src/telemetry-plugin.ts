import { definePlugin, defineSource } from '@pepys/kit';
import { logRecordFamily } from './log-record-family.ts';
import { receiveOtlpLogs } from './otlp/receive-otlp-logs.ts';
import { products } from './products/products.ts';
import { sessionModelRequestsQuery } from './queries/session-model-requests-query.ts';
import { telemetryModelRequestConsumer } from './telemetry-model-request-consumer.ts';
import { telemetryTurnCostConsumer } from './telemetry-turn-cost-consumer.ts';

export const telemetrySource = defineSource({
  name: 'telemetry',
  families: [logRecordFamily],

  // Push only. An OTLP exporter cannot sign a body, so the check is a token, and the route needs a
  // proven sender, whom each fact then holds as its `origin`.
  live: receiveOtlpLogs({
    route: '/v1/logs',

    // An exporter that gets a bare origin adds these paths itself, and retries a refusal for ever.
    ignoredRoutes: ['/v1/metrics', '/v1/traces'],
    check: { kind: 'token', header: 'authorization', secretEnv: 'PEPYS_TELEMETRY_TOKEN' },
    sender: {
      kind: 'imp-identity',
      audienceEnv: 'PEPYS_IMP_IDENTITY_AUDIENCE',
      issuersEnv: 'PEPYS_IMP_IDENTITY_ISSUERS',
    },
    products,

    // atc stamps it on every record of a session it runs
    sessionAttribute: 'atc.session.id',
    factLimit: 1000,
    bodyByteLimit: 4_194_304,
    encodings: ['gzip'],
    answer: 'empty',
  }),
});

// `telemetry:session` is a kind of this plug-in, from the family, with no table: a link may point
// at a session, and no entity view finds one.
export const telemetryPlugin = definePlugin({
  name: 'telemetry',
  sources: [telemetrySource],
  consumers: [telemetryModelRequestConsumer, telemetryTurnCostConsumer],
  queries: [sessionModelRequestsQuery],
});
