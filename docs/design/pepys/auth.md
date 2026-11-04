# Auth

The API runs its own OAuth 2.1 authorization server, so each client the owner approves gets its own
grant, and every manual fact records the client that wrote it. The server follows the OAuth
connector in the owner's agent control tower, atc: better-auth's OAuth provider and MCP plugins run
the protocol, and pepys adds the owner's passkey sign-in, the client list and the scope check. The
server serves one owner. Only clients the owner added by hand can start an authorization, and each
authorization needs a fresh passkey sign-in.

## Clients

The owner adds each client once, with
`pepys clients add <name> --kind <owner|agent> --redirect-uri <uri>`. Every client is a public
client: it holds no secret and uses PKCE with S256. pepys offers no dynamic client registration and
fetches no client metadata documents, so a client the owner never added cannot start an
authorization.

| Client                                    | Kind    | Redirect URI                         | Holds its tokens in                     |
| ----------------------------------------- | ------- | ------------------------------------ | --------------------------------------- |
| the `pepys` CLI, and scripts that call it | `owner` | `http://127.0.0.1:<port>/callback`   | a file readable only by the owner       |
| an agent, such as Claude Code or Codex    | `agent` | the agent's own loopback or callback | the agent's own credential store        |
| the dashboard in the browser              | `owner` | the dashboard's `/callback` page     | memory only, so a reload signs in again |

The kind is part of the client record, set only by the owner on the host, and never taken from a
request. An agent's client is always `agent`, whatever scopes its grant holds.

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
   token, both bound to the one resource the API serves, its origin. The oRPC routes under `/rpc`
   and the MCP endpoint at `/mcp` accept only a token bound to that origin.

The owner enrols a passkey with `pepys passkeys enroll`, which prints a one-time token that expires
in 10 minutes. The passkey's relying party is the API's tailnet host name, so a passkey works only
at that origin.

## Tokens

| Token              | Form   | Lifetime   | On use                                                        |
| ------------------ | ------ | ---------- | ------------------------------------------------------------- |
| authorization code | opaque | 10 minutes | single use; a second exchange revokes what the first made     |
| access token       | opaque | 1 hour     | checked against the auth database on every request            |
| refresh token      | opaque | 30 days    | rotates on every use; reuse revokes every grant of its client |

Tokens are opaque, with better-auth's JWT plugin off, so every request checks its token against the
database and a revoked grant fails on its next request. The database stores a hash of each token,
never the token. `pepys grants revoke <client>` revokes every grant of one client, and
`pepys clients remove <client>` removes the client as well.

## Scopes

A grant holds `read`, or `read` and `write`. Each route and each MCP tool needs one scope:

| Scope   | Allows                                                                                       |
| ------- | -------------------------------------------------------------------------------------------- |
| `read`  | every query in the core and deployment catalogs, and every change feed stream                |
| `write` | assert link and retract link, for any client kind; correct label, for an `owner` client only |

A request without the scope it needs gets HTTP 403 with `insufficient_scope` and the missing scope,
so a client learns what to ask for. A correct label from an `agent` client gets HTTP 403 whatever
its scopes, because only the owner's corrections score the model jobs, as
[agent writes](./api.md#agent-writes) sets out.

## Manual writes

The API builds each manual fact's client record from the verified token: the client's ID, name and
kind, and the grant ID. A request body never sets them. A manual link takes its origin from that
record, as [links](./links.md) describes.

The API refuses an agent's link with a confidence of 1, or with no evidence, with HTTP 422. An
`owner` client may assert a link at full confidence.

Each write carries a request ID that the client picks, and the fact ID derives from the client ID
and the request ID, as [fact IDs](./log.md#fact-ids) sets out. A client that retries a write, or an
attacker who replays one, writes the same fact again, and consumers drop the duplicate.

## Where the state lives

The auth database is a SQLite file, `auth.db`, on the API's own volume, readable only by the API's
user. It holds the clients, the passkeys' public keys, short-lived owner sessions, and token hashes.
The API never writes the store, and the host never opens `auth.db`.

The 1Password `pepys` vault holds nothing for auth. better-auth's secret is drawn at each start,
which ends the sign-ins in progress and keeps every grant. Losing `auth.db` ends every grant, and
the owner approves each client again, so `auth.db` has no backup.

## Network

The API listens only on the owner's tailnet, behind TLS for the tailnet host name. The only path the
internet reaches is the GitHub webhook, which goes to ingest and never to the API. Ingest checks the
webhook's signature, as [ingest](./ingest.md#github) describes, and OAuth plays no part in it.

The API refuses a request whose `Host` header is not its tailnet host name, so a DNS rebinding page
in the owner's browser cannot reach it. A form post to the sign-in, enrolment or consent page, and
an MCP request that carries an `Origin` header, must come from the API's own origin.

## Threats

| Threat                                       | Control                                                                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| a stolen access token                        | it reaches only the tailnet, lasts 1 hour, and stops on its next request once the owner revokes its grant                    |
| a stolen refresh token                       | rotation: when the thief or the client uses a spent refresh token, better-auth revokes every grant of that client            |
| a stolen authorization code                  | PKCE: the code is useless without the client's verifier, and it expires in 10 minutes                                        |
| an MCP client used as a confused deputy      | each token is bound to pepys's resource, pepys never sends a token on to another service, and only `write` tools change data |
| an agent asserting a link at full confidence | the API refuses it, and the link's origin names the agent, so `retract` can remove all of one agent's links                  |
| an agent correcting a label                  | the API refuses a correction from an `agent` client, whatever its scopes                                                     |
| a replayed write                             | the fact ID derives from the client and the request ID, so a replay writes a duplicate that consumers drop                   |
| a crafted authorization link                 | an unknown client or redirect URI gets an error page with fixed text, and is never redirected                                |

## Open questions

- Whether a script that runs without the owner present, such as an automation on the server, gets a
  `client_credentials` grant. The pick: no. It runs through the `pepys` CLI with a grant the owner
  approved once, as any other `owner` client does.
