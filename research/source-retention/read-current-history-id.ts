import { z } from 'zod';

const profileURL = 'https://gmail.googleapis.com/gmail/v1/users/me/profile';
const profileSchema = z.object({ historyId: z.string().min(1) });

// Reads only the mailbox's current history ID, never a message.
export async function readCurrentHistoryID(accessToken: string): Promise<string> {
  const response = await fetch(profileURL, { headers: { Authorization: `Bearer ${accessToken}` } });

  if (!response.ok) {
    throw new Error(`GET profile returned HTTP ${response.status}`);
  }

  const body: unknown = await response.json();

  return profileSchema.parse(body).historyId;
}
