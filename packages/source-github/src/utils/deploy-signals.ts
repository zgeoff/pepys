// The two signals that report a deploy, in the order a query trusts them: the tag rows of one
// repository and environment when it has any, and its deployment status rows otherwise.
export const deploySignals = ['tag', 'deployment_status'] as const;

export type DeploySignal = (typeof deploySignals)[number];
