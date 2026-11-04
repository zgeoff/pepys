// An offset is the batch number, zero-padded so that offsets sort as strings in batch order.
export function formatOffset(batch: number): string {
  return String(batch).padStart(16, '0');
}
