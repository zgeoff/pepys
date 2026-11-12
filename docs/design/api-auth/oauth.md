# The OAuth server

- **Status:** agreed
- **Decision records:** [0025](../../decisions/0025-own-oauth-server-with-passkey.md),
  [0027](../../decisions/0027-rpc-stays-off-the-public-route.md),
  [0028](../../decisions/0028-no-backup-of-auth-db.md)

The API's public listener runs an OAuth 2.1 authorization server for the owner's MCP clients. pepys
copies the server from atc, the owner's agent control tower, whose gateway serves MCP behind the
same kind of server.
[atc's OAuth doc](https://github.com/zgeoff/atc/blob/fa46d50b25a6599d2c246604509282c1a3db951a/docs/architecture/remote/oauth.md)
at that commit gives the reasons behind the rules the two servers share.

better-auth's OAuth provider and MCP plugins run the protocol. pepys adds the owner's passkey
sign-in, the list of clients the owner added, and the check of each bearer token and its scope. A
grant is everything that one approved authorization produced: its refresh tokens and every access
token issued under it. Revoking a grant ends all of them.

[Auth for the API](./README.md) holds the three listeners, the bearer check, the configuration, the
security events and the deployment. It also defines the placeholders `<public_origin>` and
`<public_host>`.

## Shape

```mermaid
flowchart LR
  client["MCP client"] -->|"1. POST /mcp, no token: 401"| api["public listener"]
  client -->|"2. opens /oauth2/authorize"| browser["owner's browser"]
  browser -->|"3. Access login, then passkey"| api
  api -->|"4. consent, then code"| client
  client -->|"5. code and PKCE verifier"| api
  api --> authdb[("auth.db")]
  admin["admin commands"] --> authdb
```

## Contracts

### The API process

A deployment's API entry passes its arguments to `serveAPI`. With no arguments, `serveAPI` serves
the listeners. With an admin command, it runs that command against `auth.db` and exits. The owner
runs each command with `kubectl exec` in the API's container, where `auth.db` lives. A command reads
only `PEPYS_AUTH_DIR` and `PEPYS_API_PUBLIC_URL`, and runs beside the server, which keeps serving.

```ts
// a deployment's API entry
serveAPI({ deployment, environment: process.env, argv: process.argv.slice(2) });
// argv [] → serves the listeners
// argv ['clients', 'add', 'Claude Code', '--redirect-uri', 'http://localhost:33418/callback']
//   → prints 'client 9f3k2m…' and exits 0
```

```ts
// @pepys/api
interface ServeAPIOptions {
  // …existing fields
  argv?: readonly string[]; // absent or empty: serve
}
```

| Command                                                      | Does                                                      |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| `clients add <name> --redirect-uri <uri> [--redirect-uri …]` | adds a public client and prints its client ID             |
| `clients`                                                    | lists the clients                                         |
| `clients remove <client_id>`                                 | removes a client with every grant and token it holds      |
| `passkeys enroll`                                            | prints a one-time token that the owner types on `/enroll` |
| `passkeys enroll --reset`                                    | ends every passkey and sign-in, then prints a token       |
| `passkeys`                                                   | lists the passkeys                                        |
| `passkeys remove <passkey_id>`                               | removes one passkey                                       |
| `grants`                                                     | lists the live grants                                     |
| `grants revoke <client_id>`                                  | revokes every grant of one client                         |

An admin command skips `checkDeployment`, the check of the deployment's plug-ins that the server
runs at start. An unknown command or a bad argument exits 2 with the usage.

### Public paths

The public listener serves the paths below. The shared Cloudflare tunnel forwards only these paths.
It sends the owner's browser through a Cloudflare Access login first, and sends a client's request
straight to the listener.

| Path                                        | Caller              | At the tunnel |
| ------------------------------------------- | ------------------- | ------------- |
| `/oauth2/authorize`                         | the owner's browser | Access login  |
| `/login`                                    | the owner's browser | Access login  |
| `/enroll`                                   | the owner's browser | Access login  |
| `/consent`                                  | the owner's browser | Access login  |
| `/error`                                    | the owner's browser | Access login  |
| `/mcp`                                      | an MCP client       | straight in   |
| `/oauth2/token`                             | an MCP client       | straight in   |
| `/oauth2/revoke`                            | an MCP client       | straight in   |
| `/.well-known/oauth-authorization-server`   | an MCP client       | straight in   |
| `/.well-known/oauth-protected-resource`     | an MCP client       | straight in   |
| `/.well-known/oauth-protected-resource/mcp` | an MCP client       | straight in   |

```http
POST /mcp HTTP/1.1
Host: <public_host>

HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="<public_origin>/.well-known/oauth-protected-resource/mcp", scope="read"
```

`GET /.well-known/oauth-protected-resource/mcp` and `GET /.well-known/oauth-protected-resource` both
answer:

```json
{
  "resource": "<public_origin>/mcp",
  "authorization_servers": ["<public_origin>"],
  "scopes_supported": ["read"],
  "bearer_methods_supported": ["header"]
}
```

### Adding a client

1. Run `passkeys enroll` once, and type the printed token on `/enroll`. Expect: one passkey in
   `passkeys`.
2. Pick a fixed callback port, `<port>`, for the client.
3. Run `clients add <name> --redirect-uri http://localhost:<port>/callback`. Expect: a client ID.
4. Add pepys to Claude Code with that client ID in `--client-id` and the same port in
   `--callback-port`. Leave out `--client-secret`, because every client is public. Expect: Claude
   Code opens the owner's browser on `/oauth2/authorize`.

## Constraints

### What better-auth does not cover

The rules in this design hold whatever better-auth does by default. Where better-auth falls short of
a rule, pepys enforces the rule in its own code, as atc does. pepys's own code does these:

- It forces a fresh passkey sign-in for each authorization.
- When an authorization request names no resource, it sets `<public_origin>/mcp` before better-auth
  sees the request.
- It adds `iss` to the redirect that carries a code (RFC 9207), and sets
  `authorization_response_iss_parameter_supported` to `true` in the authorization server metadata,
  as the MCP spec asks.
- It runs the refresh in [Tokens and grants](#tokens-and-grants), because better-auth's own refresh
  rotation is not atomic.

### Tokens and grants

- The authorization server has no dynamic client registration and never fetches a client ID metadata
  document, which a client would host to register itself. When an authorization names a client that
  the owner never added, the owner's browser gets the error page and no redirect.
- Every client is public: no secret, PKCE with S256 required.
- An authorization code lasts 10 minutes and works once. A second exchange revokes what the first
  made.
- An access token is opaque, lasts 1 hour, and is checked against `auth.db` on every request.
- A refresh token lasts 30 days and rotates on each use.
- A refresh runs as one `auth.db` transaction that consumes the old refresh token by compare and
  swap: it marks the token used only when the token is still unused and its grant still exists, and
  issues the new pair in the same transaction. When the swap changes no row, the refresh fails and
  issues nothing. The refresh takes no in-memory lock, so the rule holds across processes.
- A refresh that presents a consumed refresh token revokes that token's grant, in the same
  transaction.
- The server and an admin command open `auth.db` in WAL mode with a busy timeout. When
  `grants revoke` or `clients remove` races a refresh of the same client, every token of that client
  fails once the command has returned. A test runs the two at once.
- The API runs only in the StatefulSet pod that owns `auth.db`'s volume, never in a Kubernetes
  Deployment.
- `auth.db` stores a hash of each token, code and enrolment token, never the value.
- The API never writes a token, a code or a cookie to a log line, an error or a security event.

### The owner

- The owner is the one user, and a passkey is the one credential that signs the owner in. With no
  passkey enrolled, every sign-in fails.
- The passkey's relying party ID is `<public_host>`.
- Each authorization needs a fresh passkey sign-in for that one request. One sign-in approves one
  authorization.
- An enrolment token lasts 10 minutes and enrols one passkey.
- Three short-lived records belong to one sign-in. A ceremony is one WebAuthn exchange with the
  owner's authenticator, for sign-in or for enrolment. An owner session runs from the passkey check
  to the consent page. A pending approval is the authorization that waits on the consent page.
- `auth.db` holds the owner's generation, a number. Each ceremony, enrolment, owner session and
  pending approval records the generation it began under, and the API refuses to complete one whose
  generation is not the current one.
- `passkeys enroll --reset` runs as one transaction: it deletes every passkey, every unused
  enrolment token and every owner session, raises the generation, and stores the new enrolment
  token's hash. A ceremony or approval begun before the reset then fails, and an older enrolment
  token adds no passkey. Grants and their tokens survive the reset.
- `passkeys remove` deletes every owner session and raises the generation in the same transaction.
- The consent page lists the scopes the client asked for, with `read` ticked. The owner may untick
  it, and a consent with no scope ticked is denied.

### Requests

- The public listener answers only a request whose `Host` is `<public_host>`, and answers 403 to any
  other. The [tailnet and cluster listeners](./README.md#the-listeners) check no `Host` and no
  `Origin`.
- A form post to `/login`, `/enroll` or `/consent`, and an MCP request with an `Origin` header, must
  come from `<public_origin>`. The API answers any other with 403.
- The sign-in, enrolment, consent and error pages carry the headers below, shown as `/login` sends
  them. `<passkey_script_hash>` is the SHA-256 of the passkey script, and `<redirect_origin>` is the
  origin of the client's redirect URI. On `/login` and `/enroll`, `script-src` lists the passkey
  script; on `/consent` and `/error` it is `'none'`. On `/consent`, `form-action` adds
  `<redirect_origin>`; on the other pages it is `'self'` alone. The error page shows a fixed
  sentence per error code, never text from the request.

  ```http
  Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-<passkey_script_hash>'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'
  X-Frame-Options: DENY
  Cache-Control: no-store
  Referrer-Policy: same-origin
  ```

- The public listener sees cloudflared's address, never the caller's network address, so no limit
  counts per network address. The limit on authorizations started counts per OAuth client. The API
  never locks sign-in after failed passkey sign-ins. The API leaves the network address out of every
  security event.
- pepys turns better-auth's telemetry off, whatever the environment sets.
- The API generates better-auth's secret at random on each start. A restart ends the sign-ins in
  progress and keeps every grant. A test restarts the API with a new secret and refreshes a grant
  made before the restart.

## Decisions

- **The API runs its own authorization server, copied from atc.** pepys serves one owner, and an
  outside identity provider adds a second system to trust and to keep up. A package that atc, impz
  and pepys share is outside this design.
  ([0025](../../decisions/0025-own-oauth-server-with-passkey.md))
- **The owner signs in with a passkey.** impz, which runs the owner's coding agents, approves a
  sign-in code with one of its own API tokens. pepys has no such tokens for the owner, and a passkey
  works from each of the owner's devices.
  ([0025](../../decisions/0025-own-oauth-server-with-passkey.md))
- **The owner adds each client by hand.** The MCP authorization spec of 2026-07-28 allows
  pre-registration. Client ID metadata documents and dynamic registration would let any client start
  a sign-in. ([0025](../../decisions/0025-own-oauth-server-with-passkey.md))
- **The public route runs through the shared Cloudflare tunnel.** A route that holds a long event
  stream open needs a TLS front on the server, as impz has. The MCP route answers each post with
  JSON and opens no stream, so the shared tunnel serves it, as it serves atc's gateway.
  ([0027](../../decisions/0027-rpc-stays-off-the-public-route.md))
- **Cloudflare Access and the passkey both guard sign-in.** Access adds a login in front of the
  sign-in pages, and only the owner's passkey approves a grant, so neither one alone lets a stranger
  in.
- **A failed passkey sign-in locks nothing.** Nobody can guess a passkey assertion, so a lock adds
  no protection. A process on the cluster's node reaches the public listener without Access, and a
  lock would let it lock the owner out.
- **The API checks no Cloudflare Access header.** The passkey already stops a sign-in from a process
  on the cluster's node, and the check would need the API to reach the internet for Access's keys.
  When pepys gains a second sign-in method, the API checks the Access header on the browser paths.
- **Every grant is bound to `<public_origin>/mcp`.** Only `/mcp` takes an OAuth token, so the API
  serves one resource.
- **`auth.db` has no backup.** A lost `auth.db` costs one passkey enrolment and one sign-in per
  client. ([0028](../../decisions/0028-no-backup-of-auth-db.md))

## Builder decides

- How the public routes mount on Elysia beside better-auth's handler.
- The wording of every page and error.
- The rate limit on authorizations started.
- Whether the bearer check reuses better-auth's MCP helper or reads the token table directly.
- The better-auth version, within the
  [dependency rule](../../../.claude/skills/ci-design/SKILL.md#dependency-exceptions). `@pepys/api`
  is public, so better-auth ships as its dependency and type-checks with the kit's compiler options.
- The SQLite driver and Kysely dialect that open `auth.db`.
- How tests drive a passkey sign-in, such as a scripted authenticator, and which test lane runs the
  full flow from the 401 to a query.
