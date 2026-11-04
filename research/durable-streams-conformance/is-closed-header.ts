export function isClosedHeader(headers: Headers): boolean {
  return headers.get('stream-closed')?.toLowerCase() === 'true';
}
