# The OAuth server

The owner's MCP clients, such as Claude Code, reach the API's `/mcp` from the internet, so every MCP
request carries an access token. The API issues those tokens itself, from an OAuth 2.1 authorization
server that runs in the API's process. The owner signs in with a passkey. A client can start an
authorization only after the owner adds it by hand, and each authorization asks for a fresh passkey
sign-in and the owner's consent. A [service client](#service-clients), an agent with no person
present, signs in with its own secret instead. `/rpc`, the API's typed query route, takes no token,
so the deployment's network keeps it off the internet.

The server is the shared package `@zgeoff/mcp-auth`, which atc, boxxy and impz run too. Its
[architecture doc](https://github.com/zgeoff/tools/blob/main/docs/architecture/mcp-auth.md) covers
the OAuth routes and pages, the passkey sign-in, the token lifetimes, refresh rotation, revoke and
the request guards. pepys passes it the `read` scope, the default paths, its table names and its
clock, and serves it through the package's Elysia adapter beside `/rpc`. This doc covers what pepys
adds around it.

[The API](./api.md) covers the queries that `/mcp` serves.
[Serving MCP](../../runbooks/serving-mcp.md) gives the settings, the public paths, and the steps to
add a client and revoke a grant.
[Decision 0025](../../decisions/0025-own-oauth-server-with-passkey.md) records why the API runs its
own server with a passkey, [decision 0027](../../decisions/0027-rpc-stays-off-the-public-route.md)
why only MCP and the OAuth paths are public, and
[decision 0028](../../decisions/0028-no-backup-of-auth-db.md) why `mcp-auth.db` has no backup.

```mermaid
flowchart LR
  client["MCP client"] -->|"1. POST /mcp, no token: 401"| api["the API"]
  client -->|"2. opens /oauth2/authorize"| browser["owner's browser"]
  browser -->|"3. passkey sign-in"| api
  api -->|"4. consent, then code"| client
  client -->|"5. code and PKCE verifier"| api
  api --> authdb[("mcp-auth.db")]
  admin["admin commands"] --> authdb
```

## The deployment around the server

The API listens behind a proxy, such as a Cloudflare tunnel, that ends TLS and forwards only `/mcp`,
`POST /` and the OAuth paths. The proxy puts the browser paths behind a login of its own, such as
Cloudflare Access, and sends a client's requests straight through. Every request from the internet
therefore reaches the API from the proxy's address. A process on the API's own machine or network
reaches the API without the proxy, and so without the proxy's login. The server assumes that such a
process exists, and gives it a token only after a passkey sign-in, or for a service client's secret.

## The database and the admin commands

`mcp-auth.db` is a SQLite file in `PEPYS_AUTH_DIR`, readable only by the API's user. It holds the
clients, the passkeys' public keys, the grants and the tokens, each token as a hash. The passkeys
stay in `pepys_passkey` and the enrollment tokens in `pepys_enrollment_token`, the tables pepys used
before the package. The API writes no other file. The host writes the consumer files that the API
reads, and never opens `mcp-auth.db`.

The owner changes `mcp-auth.db` through the admin commands, which are the API's entry file run with
arguments: `clients add`, `clients remove <name>` or `--id <client_id>`, `passkeys enroll`,
`passkeys remove`, `grants`, and `grants --revoke`, among others. A command opens `mcp-auth.db`
while the server runs, and exits. The server and each command open the file in WAL mode with a busy
timeout, so the two share it. A command skips the deployment check, the check of the deployment's
plug-ins that the server runs before it listens. A revoke from a command reaches the server at the
token's next request, because the server checks each token against the file.

A serving API process accepts only the tokens that its own `mcp-auth.db` issued. Two serving
processes behind one public route, each with its own `mcp-auth.db`, would refuse each other's
tokens, so run one serving process behind each route.

A restart ends every sign-in in progress, and keeps every grant, because the grants live in
`mcp-auth.db`. Losing `mcp-auth.db` loses the clients, the passkeys and the grants. The owner then
adds each client again, enrolls a passkey, and signs each client in once. The serving API deletes
expired tokens, sessions and abandoned grants on a timer.

## The grant migration

Before the package, pepys kept one owner row in better-auth's `user` table, and each grant was the
authorization code ID that its tokens carry. The package keeps one `user` row per grant, so that one
delete revokes a grant. The server and every admin command run the migration when they open the
file, before the package opens it. `PRAGMA user_version` records that it ran, so it runs once. In
one transaction it:

1. gives each grant with a live token its own `user` row, keyed by the old grant ID, so
   `grants --revoke` takes the same ID as before;
2. points each token of those grants at its row, and deletes every other token;
3. deletes the owner row, its sessions and consents, the `pepys_grant_use` and `pepys_revoked_grant`
   tables, and their triggers;
4. rebuilds the token and session tables so that each `userId` cascades from `user`;
5. fails, and changes nothing, when `PRAGMA foreign_key_check` returns a row.

The migration keeps the passkeys and the clients. A database that pepys has not opened yet gets the
package's own tables.

## The bearer check

The package's adapter checks the bearer token of every request to `/mcp` and to `POST /`, a second
address of the MCP endpoint for a client set up with the bare origin. It answers a missing or
unknown token with 401 and the metadata challenge. pepys then:

- answers a request other than `POST` with 405, since the MCP server is stateless;
- answers a token without the `read` scope with 403 and `insufficient_scope`. A client gets such a
  token when it asks, at a refresh, for only `offline_access`.

The API answers each MCP request on its own and leaves no stream open, so a revoke needs no hook to
end a stream.

## Service clients

An agent with no person present, such as the `prod` target of `bun verify`, signs in as a service
client. It sends its ID, `service:<name>`, and its secret to `/oauth2/token` with the
`client_credentials` grant, and gets a short-lived read token that never refreshes. The package
checks the grant, and pepys gives it the clients from the JSON file at
`PEPYS_API_SERVICE_TOKENS_FILE`.

The file holds the sha256 digest of each client's secret, never the secret, and its `resource` must
be `PEPYS_API_PUBLIC_URL` followed by `/mcp`.
[Add a service client](../../runbooks/serving-mcp.md#add-a-service-client) gives the steps. pepys
departs from the package's file rules:

- pepys refuses a client with a static token, a bearer that the package takes in place of a digest.
  Anyone who read the file could use such a token.
- pepys takes a file with no clients, `"clients": {}`. The package refuses one, so removing the last
  client's entry would leave that client in place.

The API reads the file at start and on SIGHUP:

- At start, the API refuses to start when the file is missing, fails to parse, holds a static token
  or names another resource.
- On SIGHUP, the API keeps the old clients when the new file fails the same checks, and logs the
  reason to stderr. A client or a scope that the new file drops loses its access at its next
  request.
- When the API restarts, it forgets every token it issued to a service client, and each client signs
  in again.

## Security events

The API writes one line to stderr for each security event that the package records:
`pepys security ` and a JSON object. The API records an event for a started or refused
authorization, a passkey sign-in, a consent, a refused code exchange, a refused bearer token, or a
request refused for its `Host` or `Origin` header. Each event holds the socket's peer address, and
the address in the `CF-Connecting-IP` header, marked `trusted` only when the peer is in
`PEPYS_API_TRUST_FORWARDED_FROM`.

The API writes at most 20 events of each kind a minute. Past that, it counts the dropped events, and
writes one `suppressed` event with the count at the end of the minute, so a flood of refused tokens
never fills the log.
