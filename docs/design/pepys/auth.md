# Auth

The API's OAuth 2.1 authorization server, the owner's passkey sign-in, the clients the owner adds,
and the `read` scope on `/mcp` are built, as
[the OAuth server](../../architecture/queries/oauth-server.md) describes. This design adds the
`write` scope with the core writes, the client record on each manual fact, and the token check on
change feed streams. [Auth for the API](../api-auth/README.md) holds the design of the service
tokens that scripts and pods send to `/rpc`.

## Scopes

A grant holds `read`, or `read` and `write`. Each route and each MCP tool needs one scope:

| Scope   | Allows                                                                        |
| ------- | ----------------------------------------------------------------------------- |
| `read`  | every query in the core and deployment catalogs, and every change feed stream |
| `write` | assert link, retract link and correct label                                   |

A request without the scope it needs gets HTTP 403 with `insufficient_scope` and the missing scope,
so a client learns what to ask for. `write` arrives with the first write route, and the owner then
approves it for each client.

## Manual writes

The API builds each manual fact's client record from the verified token: the client's ID and name,
and the grant ID. A request body never sets them. A manual link takes its origin from that record,
as [links](./links.md) describes, and the API refuses a link with no evidence with HTTP 422.

A label correction from any client joins the labelled data that scores the mail label job, as
[agent writes](./api.md#agent-writes) sets out. Each correction names its client, so the evaluation
report counts the corrections per client, and the owner can drop one client's corrections from the
score.

Each write carries a request ID that the client picks, and the fact ID derives from the client ID
and the request ID, as [fact IDs](./log.md#fact-ids) sets out. A client that retries a write, or an
attacker who replays one, writes the same fact again, and consumers drop the duplicate.

## Change feed streams

A change feed stream outlives a single request. The API checks the stream's token against the
database before it sends each batch, and closes the stream when the token has expired or its grant
is revoked. The reader reconnects from its offset with a fresh token.

## Network

The API's internal port, which serves change feed reads and search to [enrichment](./enrichment.md),
is outside [auth for the API](../api-auth/README.md), and [runtime](./runtime.md#network) lists it.
Ingest checks the GitHub webhook's signature, as [ingest](./ingest.md#github) describes, and OAuth
plays no part in it.

## Threats

[The OAuth server](../../architecture/queries/oauth-server.md) covers the threats to tokens, codes
and sign-in. This design adds these:

| Threat                                   | Control                                                                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| a stolen access token on a stream        | the stream stops at its next batch once the owner revokes its grant                                                          |
| a prompt-injected agent writing bad data | every manual fact names its client, so the owner retracts that client's links and drops its corrections from the score       |
| an MCP client used as a confused deputy  | each token is bound to pepys's resource, pepys never sends a token on to another service, and only `write` tools change data |
| a replayed write                         | the fact ID derives from the client and the request ID, so a replay writes a duplicate that consumers drop                   |
