// A stub fact-mode entry: one row per voyage, a link to its vessel and a hub link to its port.
export function applyFact(factJSON: string): string {
  const fact = parseVoyageFact(factJSON);

  const row = {
    id: fact.entity,
    vessel_id: fact.payload.vessel,
    port_id: fact.payload.port,
    is_hailed: true,
    departed_at: fact.at,
  };

  const evidence = `fact ${fact.id}`;

  return JSON.stringify([
    { upsert: { harbour_voyage: row } },
    {
      link: {
        type: 'voyage_of',
        from: fact.entity,
        to: fact.payload.vessel,
        confidence: fact.payload.confidence,
        evidence,
      },
    },
    {
      link: {
        type: 'called_at',
        from: fact.entity,
        to: fact.payload.port,
        confidence: 1,
        evidence,
      },
    },
  ]);
}

interface VoyageFact {
  id: string;
  entity: string;
  at: string;
  payload: { vessel: string; port: string; confidence: number };
}

function parseVoyageFact(factJSON: string): VoyageFact {
  const parsed: unknown = JSON.parse(factJSON);

  if (!isVoyageFact(parsed)) {
    throw new Error('the fact is no voyage fact');
  }

  return parsed;
}

function isVoyageFact(value: unknown): value is VoyageFact {
  if (
    !isRecord(value) ||
    typeof value['id'] !== 'string' ||
    typeof value['entity'] !== 'string' ||
    typeof value['at'] !== 'string'
  ) {
    return false;
  }

  const payload = value['payload'];

  return (
    isRecord(payload) &&
    typeof payload['vessel'] === 'string' &&
    typeof payload['port'] === 'string' &&
    typeof payload['confidence'] === 'number'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
