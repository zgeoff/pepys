import { z } from 'zod';

export interface GmailCredentials {
  readonly clientID: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

const tokenURL = 'https://oauth2.googleapis.com/token';
const tokenSchema = z.object({ access_token: z.string().min(1) });

export async function readGmailAccessToken(credentials: GmailCredentials): Promise<string> {
  const response = await fetch(tokenURL, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: credentials.clientID,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new Error(`POST ${tokenURL} returned HTTP ${response.status}`);
  }

  const body: unknown = await response.json();

  return tokenSchema.parse(body).access_token;
}
