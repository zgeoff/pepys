import type { SpoolLine } from './types.ts';

interface Receipt {
  nowMs: number;
  userAgent: string | null;
  body: unknown;
}

// The text of one spool line, with its line break.
export function buildSpoolLine(receipt: Receipt): string {
  const line: SpoolLine = {
    received: new Date(receipt.nowMs).toISOString(),
    path: '/v1/logs',
    ua: receipt.userAgent,
    body: receipt.body,
  };

  return `${JSON.stringify(line)}\n`;
}
