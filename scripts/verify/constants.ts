import { e2eDeployment } from '../../packages/cli/e2e/fixtures/e2e-deployment.ts';

// The two core tools, which every deployment's API serves beside its plug-ins' queries.
const coreTools = ['get_entity', 'neighbourhood'];

// The service client that `local` mints for each run, and the variable of the supervisor's
// environment that holds its secret. Every tool the e2e deployment serves reads.
export const localMCPClient = {
  name: 'verify-local',
  secretEnv: 'PEPYS_VERIFY_LOCAL_MCP_SECRET',
  readTools: [
    ...coreTools,
    ...e2eDeployment.plugins.flatMap((plugin) => plugin.queries.map((query) => query.name)),
  ],
};

// The read client of the deployed API, which holds only the read scope, so the server refuses any
// write that the read-only fence misses. Every tool the deployed deployment serves reads.
export const prodMCPClient = {
  name: 'wringer-ro',
  secretEnv: 'PEPYS_PROD_MCP_SECRET',
  readTools: [
    ...coreTools,
    'github_pull_request_delivery',
    'telemetry_session_model_requests',
    'boxxy_cost_to_land',
    'boxxy_stage_time',
  ],
};

// The deployed API's public origin, its OAuth issuer and the origin of its `/mcp` resource. Its
// tailnet name serves `/rpc` alone: the API's Host check refuses `/mcp` there.
export const prodOrigin = 'https://pepys.geoff.cloud';
