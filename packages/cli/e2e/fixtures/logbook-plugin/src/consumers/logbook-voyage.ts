import {
  initLogbookVoyageModel,
  linkLogbookVoyageCites,
  parseLogbookVoyageFact,
  parseLogbookVoyageID,
  toGithubPullRequestID,
  updateLogbookVoyageModel,
} from '../generated/logbook-voyage-boundary.ts';
import type {
  LogbookVoyageMessage,
  LogbookVoyageModel,
  LogbookVoyageOperation,
} from '../generated/logbook-voyage-boundary.ts';

export type {
  LogbookVoyageMessage,
  LogbookVoyageModel,
} from '../generated/logbook-voyage-boundary.ts';

// scriptc takes the model and message types through a re-export, but not the two functions
export function init(): LogbookVoyageModel {
  return initLogbookVoyageModel();
}

export function update(
  model: LogbookVoyageModel,
  message: LogbookVoyageMessage,
): LogbookVoyageModel {
  return updateLogbookVoyageModel(model, message);
}

export function applyFact(factJSON: string): string {
  return JSON.stringify(mapFact(factJSON));
}

function mapFact(factJSON: string): LogbookVoyageOperation[] {
  const fact = parseLogbookVoyageFact(factJSON);
  const id = fact === undefined ? undefined : parseLogbookVoyageID(fact.entity);

  if (fact === undefined || id === undefined) {
    return [];
  }

  const row: LogbookVoyageOperation = {
    upsert: {
      logbook_voyage: {
        id,
        title: fact.payload.title,
        harbour: fact.payload.harbour,
        logged_at: fact.at,
      },
    },
  };

  if (fact.payload.cites === undefined) {
    return [row];
  }

  return [
    row,
    linkLogbookVoyageCites({
      from: id,
      to: toGithubPullRequestID(`${fact.payload.cites}`),
      confidence: 1,
      evidence: fact.id,
    }),
  ];
}
