import type { ConsumerDeclaration } from '@pepys/kit';

export interface CurrentFile {
  consumer: ConsumerDeclaration;

  // the consumer file of the current version, every link resolved; null with no current version
  path: string | null;
}

export interface AttachedFile {
  consumer: ConsumerDeclaration;
  path: string;
}

export type AttachPlan =
  | { kind: 'missing'; consumers: readonly string[] }
  | { kind: 'attach'; files: readonly AttachedFile[]; skipped: readonly string[] };

// Which files one call attaches: every required consumer's, else the call fails naming each one
// with no current version; then each optional consumer's that has one. A name attaches once.
export function pickAttachedFiles(
  required: readonly CurrentFile[],
  optional: readonly CurrentFile[],
): AttachPlan {
  const missing = required.filter((file) => file.path === null).map((file) => file.consumer.name);

  if (missing.length > 0) {
    return { kind: 'missing', consumers: missing };
  }

  const files = new Map<string, AttachedFile>();
  const skipped = new Set<string>();

  for (const file of [...required, ...optional]) {
    const name = file.consumer.name;

    if (file.path === null) {
      skipped.add(name);
    } else if (!files.has(name)) {
      files.set(name, { consumer: file.consumer, path: file.path });
    }
  }

  return { kind: 'attach', files: [...files.values()], skipped: [...skipped] };
}
