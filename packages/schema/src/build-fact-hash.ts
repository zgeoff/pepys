export function buildFactHash(fields: readonly string[]): string {
  // A JSON array keeps each field's boundary, which a delimiter-joined string would let a field forge.
  return new Bun.CryptoHasher('sha256').update(JSON.stringify(fields)).digest('hex');
}
