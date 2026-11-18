// forwarder, the send loop. The receiver reads it for each `GET /health`.
export interface SendState {
  // off: no ingest URL. sending: no request has failed since the last one that moved the position.
  send: 'off' | 'sending' | 'waiting' | 'stopped';

  // waiting and stopped only: the last answer, null for none
  status?: number | null;

  // waiting and stopped only: when the state began
  since?: string;

  // the lines in the files under `failed/`
  failed: number;
}
