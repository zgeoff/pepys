// The agent-sdk-bump job in model-api.yml runs its script with no install, so @zgeoff/std is absent.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
