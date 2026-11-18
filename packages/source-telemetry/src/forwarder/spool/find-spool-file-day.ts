const spoolFileName = /^(?<day>\d{4}-\d{2}-\d{2})-logs\.jsonl$/u;

// The UTC day in the name of a spool file, or null for any other name.
export function findSpoolFileDay(name: string): string | null {
  return spoolFileName.exec(name)?.groups?.['day'] ?? null;
}
