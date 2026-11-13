// Every failure body is `{"error": "<reason>"}`, on every path.
export function buildFailureAnswer(status: number, reason: string): Response {
  return Response.json({ error: reason }, { status });
}

// 503 means "send the same delivery again, unchanged". A sender that never sends a batch twice,
// such as Codex's exporter, loses the batch.
export function buildRetryAnswer(): Response {
  return Response.json(
    { error: 'the batch is not stored, send it again' },
    { status: 503, headers: { 'retry-after': '1' } },
  );
}
