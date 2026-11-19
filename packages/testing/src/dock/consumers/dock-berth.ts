import {
  initDockBerthModel,
  parseDockBerthID,
  readScopeFacts,
  updateDockBerthModel,
} from '../generated/dock-berth-boundary.ts';
import type {
  DockBerthID,
  DockBerthMessage,
  DockBerthModel,
  DockBerthOperation,
} from '../generated/dock-berth-boundary.ts';

export type { DockBerthMessage, DockBerthModel } from '../generated/dock-berth-boundary.ts';

// scriptc takes the model and message types through a re-export, but not the two functions
export function init(): DockBerthModel {
  return initDockBerthModel();
}

export function update(model: DockBerthModel, message: DockBerthMessage): DockBerthModel {
  return updateDockBerthModel(model, message);
}

export function applyScope(scope: string): string {
  const berth = parseDockBerthID(scope);

  if (berth === undefined) {
    return JSON.stringify([]);
  }

  return JSON.stringify(mapBerth(berth));
}

// The row shows the fact IDs in the order the host handed them over, so a host that reads one
// stream, or merges the two in another order, gives another row.
function mapBerth(berth: DockBerthID): DockBerthOperation[] {
  let arrivals = 0;
  let tonnes = 0;
  let readOrder = '';
  let updatedAt = '';

  for (const fact of readScopeFacts(berth)) {
    readOrder = readOrder === '' ? fact.id : `${readOrder} ${fact.id}`;
    updatedAt = fact.at;

    if (fact.type === 'dock.arrival.logged') {
      arrivals += 1;
    } else {
      tonnes += fact.payload.tonnes;
    }
  }

  if (updatedAt === '') {
    return [];
  }

  return [
    {
      upsert: {
        dock_berth: {
          id: berth,
          arrivals,
          tonnes,
          read_order: readOrder,
          updated_at: updatedAt,
        },
      },
    },
  ];
}
