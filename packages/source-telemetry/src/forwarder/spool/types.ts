// One line of `<day>-logs.jsonl`, as JSON with no line break inside.
export interface SpoolLine {
  // when the receiver took the export, ISO 8601 in UTC
  received: string;
  path: '/v1/logs';

  // the exporter's `user-agent`
  ua: string | null;

  // the export as parsed JSON, after gzip is unpacked
  body: unknown;
}

export interface Position {
  // the byte offset of the first line not yet sent
  offset: number;

  // when the send loop first found this file of an earlier day with no unsent line
  sentAt?: string | undefined;
}

// by file name; a spool file with no entry starts at offset 0
export type Positions = Record<string, Position>;

// One line of a file under `failed/`.
export interface FailedLine {
  // the spool line as parsed JSON, or its text when it does not parse
  line: unknown;
  failed: { at: string; status: number | null; reason: string };
}
