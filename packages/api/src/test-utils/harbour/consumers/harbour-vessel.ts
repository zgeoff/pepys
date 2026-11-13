// A stub fact-mode entry: one row per vessel, named by its newest fact, and the name in lowercase
// as an alias of the vessel.
export function applyFact(factJSON: string): string {
  const fact = parseVesselFact(factJSON);
  const row = { id: fact.entity, name: fact.payload.name, updated_at: fact.at };
  const alias = { alias: fact.payload.name.toLowerCase(), entity_id: fact.entity };

  return JSON.stringify([
    { upsert: { harbour_vessel: row } },
    { upsert: { harbour_vessel_alias: alias } },
  ]);
}

interface VesselFact {
  entity: string;
  at: string;
  payload: { name: string };
}

function parseVesselFact(factJSON: string): VesselFact {
  const parsed: unknown = JSON.parse(factJSON);

  if (!isVesselFact(parsed)) {
    throw new Error('the fact is no vessel fact');
  }

  return parsed;
}

function isVesselFact(value: unknown): value is VesselFact {
  if (!isRecord(value) || typeof value['entity'] !== 'string' || typeof value['at'] !== 'string') {
    return false;
  }

  const payload = value['payload'];

  return isRecord(payload) && typeof payload['name'] === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
