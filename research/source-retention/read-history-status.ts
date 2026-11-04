const historyURL = 'https://gmail.googleapis.com/gmail/v1/users/me/history';

// Returns the HTTP status alone and drops the body, so no message ID leaves this function.
export async function readHistoryStatus(
  accessToken: string,
  historyID: string,
): Promise<200 | 404> {
  const query = new URLSearchParams({ startHistoryId: historyID, maxResults: '1' });

  const response = await fetch(`${historyURL}?${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  await response.body?.cancel();

  if (response.status === 200 || response.status === 404) {
    return response.status;
  }

  throw new Error(`GET history returned HTTP ${response.status}`);
}
