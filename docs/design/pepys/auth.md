# Auth

The API runs its own OAuth 2.1 authorization server, so each client the owner approves gets its own
grant, and every manual fact records the client that wrote it.
[The OAuth server](../api-auth/oauth.md) holds its design: better-auth's OAuth provider and MCP
plugins run the protocol, and pepys adds the owner's passkey sign-in, the list of clients the owner
added, and the scope check. The server serves one owner. Only clients that were added on the server
can start an authorization, and each authorization needs a fresh passkey sign-in.

## Clients

The clients are agents over MCP, such as Claude Code and Codex. A script that reads oRPC takes a
service token instead, as [auth for the API](../api-auth/README.md) sets out. Every client is a
public client: it holds no secret and uses PKCE with S256. pepys offers no dynamic client
registration and fetches no client metadata documents, so a client that nobody added cannot start an
authorization.

A client is added on the server with `clients add <name> --redirect-uri <uri>`, which the owner, or
an agent the owner asks, runs once per client. All clients have the same rights, and the grant's
scopes set what each one may do.

## Getting a grant

1. The client calls the API with no token, and gets HTTP 401 with a challenge that points at the
   protected resource metadata.
2. The client sends the owner's browser to the authorization endpoint. pepys refuses an unknown
   client, or a redirect URI the client was not added with, on an error page that redirects nowhere.
3. pepys forces a fresh passkey sign-in for this one request, and shows the client's name and full
   redirect URI.
4. The consent page lists the scopes the client asked for, with only `read` ticked. One sign-in
   approves exactly one authorization.
5. The client exchanges the code once, with its PKCE verifier. Expect: an access token and a refresh
   token, both bound to the one resource the API serves, its MCP endpoint. `/mcp` accepts only a
   token bound to that resource.

Before the first grant, the owner runs `passkeys enroll` in the API's container. It prints a
one-time enrollment token, and the owner types it on the API's `/enroll` page.
[The owner](../api-auth/oauth.md#the-owner) gives the token's rules. The passkey's relying party is
the API's public host name, so a passkey works only at that origin.

## Tokens

| Token              | Form   | Lifetime   | On use                                                    |
| ------------------ | ------ | ---------- | --------------------------------------------------------- |
| authorization code | opaque | 10 minutes | single use; a second exchange revokes what the first made |
| access token       | opaque | 1 hour     | checked against the auth database on every request        |
| refresh token      | opaque | 30 days    | rotates on every use; reuse revokes the client's tokens   |

Tokens are opaque, with better-auth's JWT plugin off, so every request checks its token against the
database and a revoked grant fails on its next request. The database stores a hash of each token,
never the token.

better-auth rotates a refresh token with one SQL update that marks it used only while it is still
unused, so of two refreshes that overlap, one fails. A reused refresh token revokes every token of
its client. [Tokens and grants](../api-auth/oauth.md#tokens-and-grants) gives the gap between that
update and the write of the new pair.

A change feed stream outlives a single request. The API checks the stream's token against the
database before it sends each batch, and closes the stream when the token has expired or its grant
is revoked. The reader reconnects from its offset with a fresh token. `grants --revoke=<grant_id>`
revokes one grant, and `clients remove <client_id>` revokes every grant of one client and removes
the client.

## Scopes

A grant holds `read`, or `read` and `write`. Each route and each MCP tool needs one scope:

| Scope   | Allows                                                                        |
| ------- | ----------------------------------------------------------------------------- |
| `read`  | every query in the core and deployment catalogs, and every change feed stream |
| `write` | assert link, retract link and correct label                                   |

A request without the scope it needs gets HTTP 403 with `insufficient_scope` and the missing scope,
so a client learns what to ask for.

The API offers only `read` for now. `write` arrives with the first write route, and the owner then
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

## Where the state lives

The auth database is a SQLite file, `mcp-auth.db`, on the API's own volume, readable only by the
API's user. It holds the clients, the passkeys' public keys, short-lived owner sessions, and token
hashes. The API never writes the store, and the host never opens `mcp-auth.db`.

1Password holds the service tokens, one item per credential, and nothing for OAuth. better-auth's
secret is generated at random at each start, which ends the sign-ins in progress and keeps every
grant. Losing `mcp-auth.db` ends every grant, and the owner approves each client again, so
`mcp-auth.db` has no backup.

## Network

The API serves MCP and the sign-in pages on a public route through a Cloudflare tunnel, and oRPC on
the owner's tailnet and inside the k3s cluster that runs pepys with service tokens.
[Auth for the API](../api-auth/README.md) holds its listeners, the credential each one takes, and
the checks on each request. The API's internal port, which serves change feed reads and search to
[enrichment](./enrichment.md), is outside that design, and [runtime](./runtime.md#network) lists it.
Ingest checks the GitHub webhook's signature, as [ingest](./ingest.md#github) describes, and OAuth
plays no part in it.

## Threats

| Threat                                   | Control                                                                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| a stolen access token                    | it opens only `/mcp`, lasts 1 hour, and stops on its next request or stream batch once the owner revokes its grant           |
| a stolen refresh token                   | rotation in one transaction: a spent refresh token revokes its grant                                                         |
| a stolen service token                   | it works only on the listeners its entry in the callers file names, and the owner revokes it with no restart                 |
| a prompt-injected agent writing bad data | every manual fact names its client, so the owner retracts that client's links and drops its corrections from the score       |
| a stolen authorization code              | PKCE: the code is useless without the client's verifier, and it expires in 10 minutes                                        |
| an MCP client used as a confused deputy  | each token is bound to pepys's resource, pepys never sends a token on to another service, and only `write` tools change data |
| a replayed write                         | the fact ID derives from the client and the request ID, so a replay writes a duplicate that consumers drop                   |
| a crafted authorization link             | an unknown client or redirect URI gets an error page with fixed text, and is never redirected                                |
