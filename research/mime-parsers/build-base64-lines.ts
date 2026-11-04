// Wraps at 76 characters, the line limit RFC 2045 sets for base64.
export function buildBase64Lines(bytes: Uint8Array): string {
  const lines = bytes.toBase64().match(/.{1,76}/gu) ?? [];

  return `${lines.join('\n')}\n`;
}
