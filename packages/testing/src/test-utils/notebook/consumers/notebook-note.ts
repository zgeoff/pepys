declare function readNotebookNoteLength(key: string): number;
declare function readNotebookNoteInto(key: string, row: Uint8Array): void;

// A stub fact-mode entry: it counts the notes of one entity through its row read, and keeps the
// issuer of the fact's origin.
export function applyFact(factJSON: string): string {
  const fact = parseNoteFact(factJSON);
  const count = readCount(fact.entity);

  const row = {
    id: fact.entity,
    text: fact.payload.text,
    count: count + 1,
    issuer: fact.payload.origin.issuer,
  };

  return JSON.stringify([{ upsert: { notebook_note: row } }]);
}

interface NoteFact {
  entity: string;
  payload: { text: string; origin: { issuer: string } };
}

function parseNoteFact(factJSON: string): NoteFact {
  const parsed: unknown = JSON.parse(factJSON);

  if (!isNoteFact(parsed)) {
    throw new Error('the fact is no note fact');
  }

  return parsed;
}

function isNoteFact(value: unknown): value is NoteFact {
  if (!isRecord(value) || typeof value['entity'] !== 'string') {
    return false;
  }

  const payload = value['payload'];

  return (
    isRecord(payload) &&
    typeof payload['text'] === 'string' &&
    isRecord(payload['origin']) &&
    typeof payload['origin']['issuer'] === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readCount(entity: string): number {
  const length = readNotebookNoteLength(entity);

  if (length < 0) {
    return 0;
  }

  const buffer = new Uint8Array(length);

  readNotebookNoteInto(entity, buffer);

  const stored: unknown = JSON.parse(new TextDecoder().decode(buffer));

  return isRecord(stored) && typeof stored['count'] === 'number' ? stored['count'] : 0;
}
