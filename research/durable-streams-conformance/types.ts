import type { ChangeLog, StreamRow } from './create-change-log.ts';

export interface ChangeFeedServerOptions {
  readonly changeLog: ChangeLog;
  readonly port: number;
  readonly longPollTimeoutMs: number;
  readonly sseConnectionMs: number;
  readonly maxChunkBytes: number;
}

export interface HandlerContext {
  readonly options: ChangeFeedServerOptions;
  readonly notifyCommit: (path: string) => void;
  readonly waitForCommit: (
    path: string,
    timeoutMs: number,
    signal: AbortSignal,
  ) => Promise<boolean>;
}

export interface ReadTarget {
  readonly ctx: HandlerContext;
  readonly request: Request;
  readonly stream: StreamRow;
  readonly after: number;
  readonly cursor: string;
}
