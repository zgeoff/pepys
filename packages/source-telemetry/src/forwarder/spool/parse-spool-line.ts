export type ParsedSpoolLine =
  | { kind: 'sendable'; requestBody: string; line: unknown }
  | { kind: 'unsendable'; line: unknown; reason: string };

// A line is sent when it parses as JSON, its `path` is `/v1/logs`, and its `body` is an object.
// It checks no other field.
export function parseSpoolLine(text: string): ParsedSpoolLine {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: 'unsendable', line: text, reason: 'the line does not parse as JSON' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'unsendable', line: parsed, reason: 'the line is not a JSON object' };
  }

  if (!('path' in parsed) || parsed.path !== '/v1/logs') {
    return { kind: 'unsendable', line: parsed, reason: 'the line has no path /v1/logs' };
  }

  const body = 'body' in parsed ? parsed.body : undefined;

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { kind: 'unsendable', line: parsed, reason: 'the line has no body object' };
  }

  return { kind: 'sendable', requestBody: JSON.stringify(body), line: parsed };
}
