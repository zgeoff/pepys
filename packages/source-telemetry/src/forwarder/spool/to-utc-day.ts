// The UTC day of a moment, such as `2026-03-02`.
export function toUTCDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}
