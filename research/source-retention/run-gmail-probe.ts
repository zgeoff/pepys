import { z } from 'zod';
import { buildHistoryVerdict } from './build-history-verdict.ts';
import type { HistoryState } from './build-history-verdict.ts';
import { readCurrentHistoryID } from './read-current-history-id.ts';
import { readGmailAccessToken } from './read-gmail-access-token.ts';
import { readHistoryStatus } from './read-history-status.ts';

const environmentSchema = z.object({
  PEPYS_GMAIL_CLIENT_ID: z.string().min(1),
  PEPYS_GMAIL_CLIENT_SECRET: z.string().min(1),
  PEPYS_GMAIL_REFRESH_TOKEN: z.string().min(1),
  PEPYS_SPIKE_STATE_PATH: z.string().min(1),
});

const probeSchema = z.object({ at: z.iso.datetime(), httpStatus: z.literal([200, 404]) });

const stateSchema = z.object({
  historyID: z.string().min(1),
  storedAt: z.iso.datetime(),
  probes: z.array(probeSchema),
});

const environment = environmentSchema.parse(process.env);
const stateFile = Bun.file(environment.PEPYS_SPIKE_STATE_PATH);

const hasStoredState = await stateFile.exists();

const storedJSON: unknown = hasStoredState ? await stateFile.json() : null;
const storedState = hasStoredState ? stateSchema.parse(storedJSON) : null;
const storedVerdict = storedState === null ? null : buildHistoryVerdict(storedState);

if (storedVerdict !== null && storedVerdict.firstExpiredAgeHours !== null) {
  // The ID has expired, so a further call measures nothing.
  console.log(JSON.stringify(storedVerdict, null, 2));
  process.exit(0);
}

const accessToken = await readGmailAccessToken({
  clientID: environment.PEPYS_GMAIL_CLIENT_ID,
  clientSecret: environment.PEPYS_GMAIL_CLIENT_SECRET,
  refreshToken: environment.PEPYS_GMAIL_REFRESH_TOKEN,
});

const nextState = await readNextState(accessToken, storedState);

const verdict = buildHistoryVerdict(nextState);

await Bun.write(stateFile, `${JSON.stringify(nextState, null, 2)}\n`);

console.log(JSON.stringify(verdict, null, 2));

// The first run stores the mailbox's current history ID, and each later run probes it once.
async function readNextState(token: string, state: HistoryState | null): Promise<HistoryState> {
  if (state === null) {
    const historyID = await readCurrentHistoryID(token);

    return { historyID, storedAt: new Date().toISOString(), probes: [] };
  }

  const httpStatus = await readHistoryStatus(token, state.historyID);

  return { ...state, probes: [...state.probes, { at: new Date().toISOString(), httpStatus }] };
}
