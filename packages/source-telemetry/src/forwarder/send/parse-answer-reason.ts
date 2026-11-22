const maxReasonLength = 500;

// The reason in an ingest answer, which is `{"error": "<reason>"}`, or the start of the text
// of an answer that has another shape.
export function parseAnswerReason(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text);

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'error' in parsed &&
      typeof parsed.error === 'string'
    ) {
      return parsed.error.slice(0, maxReasonLength);
    }
  } catch {
    // the text is not JSON
  }

  return text.slice(0, maxReasonLength);
}
