// The consumers import no ingest code, so they keep their own list of product names. A test holds
// it equal to the product list of the source.
export type ProductName = 'claude_code' | 'codex';

export interface KeyValue {
  key: string;
  value: unknown;
}

// The part of a stored log record that a product's reader looks at.
export interface StoredRecord {
  resource: { attributes: readonly KeyValue[] };
  logRecord: { attributes?: readonly KeyValue[] | undefined };
}

export interface ModelRequestFields {
  agent_session: string | null;
  model: string;
  input_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  output_tokens: number;

  // null when the product reports no cost for one request
  reported_cost_usd: number | null;
  duration_ms: number | null;
  agent: string | null;
}

export interface TurnCostFields {
  agent_session: string | null;
  model: string | null;
  cost_usd: number;
}
