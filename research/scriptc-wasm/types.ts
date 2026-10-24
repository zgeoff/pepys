export interface SpikeTools {
  wasmtime: string;
  wasmTools: string;
  zig: string;
  adapters: string;
}

export interface SpikeContext {
  tools: SpikeTools;
  directory: string;
}

export interface CheckReport {
  isPassing: boolean;
  lines: string[];
}
