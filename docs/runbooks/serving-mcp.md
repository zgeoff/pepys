# Serving MCP

Use this runbook to serve the API's MCP endpoint, `/mcp`, to the owner's MCP clients over the
internet, to add a client, and to revoke a client's access. The API serves `/mcp` only behind its
own OAuth server, which [The OAuth server](../architecture/queries/oauth-server.md) describes.
Before you start, run a deployment with the steps in [Deploying pepys](./deploying.md). The API's
other route, `/rpc`, takes no token, so these steps keep it off the internet.

These placeholders appear in the steps:

- `<public_host>`: the host name that clients reach the API at.
- `<public_origin>`: `https://<public_host>`.
- `<api_entry>`: the deployment's API entry file, which
  [1. Write the deployment](./deploying.md#1-write-the-deployment) has you write.

A grant is one client's access from one approved sign-in. Each grant holds the client's tokens, and
revoking it ends them.

## 1. Route the public paths

Put a proxy that ends TLS in front of the API, such as a Cloudflare tunnel. Forward only the paths
below to the API's port. Set the proxy to answer 404 to every other path, `/rpc/*` included.

| Path                                        | Caller              |
| ------------------------------------------- | ------------------- |
| `/oauth2/authorize`                         | the owner's browser |
| `/login`                                    | the owner's browser |
| `/enroll`                                   | the owner's browser |
| `/consent`                                  | the owner's browser |
| `/error`                                    | the owner's browser |
| `/mcp`                                      | an MCP client       |
| `/`, `POST` only                            | an MCP client       |
| `/oauth2/token`                             | an MCP client       |
| `/oauth2/revoke`                            | an MCP client       |
| `/.well-known/oauth-authorization-server`   | an MCP client       |
| `/.well-known/oauth-protected-resource`     | an MCP client       |
| `/.well-known/oauth-protected-resource/mcp` | an MCP client       |

`POST /` is a second address of `/mcp`, for a client set up with the bare origin.

1. Put the browser paths behind a login that admits only the owner, such as Cloudflare Access.
2. Send the MCP client paths straight to the API. An MCP client can't pass a browser login.
3. Keep each request's `Host` unchanged. When the proxy can't, list the `Host` values it sends in
   `PEPYS_API_ALLOWED_HOSTS`, in the next section.

## 2. Set the API's settings

Serve each public route from one API process. That process alone holds the tokens it issued, in its
`mcp-auth.db`, so a second serving process with another `PEPYS_AUTH_DIR` refuses them. An admin
command is no serving process, and shares the first process's `mcp-auth.db`.

1. Set these variables for the API, in addition to the ones in
   [4. Start the processes](./deploying.md#4-start-the-processes):
   - `PEPYS_API_PUBLIC_URL`: `<public_origin>`, with no path. For a local run, an `http://` origin
     with a loopback host also works.
   - `PEPYS_AUTH_DIR`: a folder on a disk that lasts across restarts. The API keeps `mcp-auth.db`,
     the OAuth server's database, there. Mount the folder in the API's container only.
   - `PEPYS_API_HOST`: an address the proxy reaches, such as `0.0.0.0`.
2. When the proxy rewrites `Host`, set `PEPYS_API_ALLOWED_HOSTS` to the values it sends, split by
   commas.
3. To see the real client address in the API's security log, set `PEPYS_API_TRUST_FORWARDED_FROM` to
   the proxy's IP addresses, split by commas. The API writes one `pepys security` line to stderr for
   each sign-in and each refused token. With the variable set, the API marks the client address that
   the proxy forwards `trusted`, and otherwise `unverified`.
4. Start the API.

   Expect: the API logs
   `api listening on http://<host>:<port>, serving /mcp at <public_origin>/mcp`, where `<host>` and
   `<port>` are the address it binds.

With `PEPYS_API_PUBLIC_URL` set, the API prints the reason and exits 1 at start in these cases:

- `PEPYS_API_PUBLIC_URL` is not a URL, carries a path, a query or credentials, or uses `http://`
  with a host that is not loopback.
- `PEPYS_AUTH_DIR` is unset.
- `PEPYS_API_PUBLIC_URL` uses `http://` and `PEPYS_API_HOST` is not a loopback address.

## 3. Add a client

Run each admin command in the API's container, as `bun <api_entry> <command>`, with the same
`PEPYS_AUTH_DIR` as the API. The command runs while the API keeps serving, and then exits. An
unknown command prints the usage of every command and exits 2.

1. Run `bun <api_entry> passkeys`.

   Expect: a list of the enrolled passkeys. When it lists one, go to step 4.

2. Run `bun <api_entry> passkeys enroll`.

   Expect: an enrollment token, which expires soon.

3. Right away, open `<public_origin>/enroll` in the owner's browser. Type the token, and create the
   passkey when the browser asks.

   Expect: `bun <api_entry> passkeys` lists the new passkey.

4. Pick a free port, `<port>`, on the machine that runs the MCP client. The client listens there for
   the browser's redirect. The server matches every other part of the redirect URI exactly, and lets
   the port of an `http://localhost` redirect URI vary, as RFC 8252 section 8.3 asks. Claude Code
   takes a fixed port, so give it the same `<port>` in step 6.
5. Run this command, with the client's name in place of `<name>`:

   ```sh
   bun <api_entry> clients add <name> --redirect-uri http://localhost:<port>/callback
   ```

   Expect: `Added <name>. Its client ID is <client_id>`.

6. Add the MCP server to the client. For Claude Code, run this command, with a name for the server
   in place of `<server_name>`:

   ```sh
   claude mcp add --transport http --client-id <client_id> --callback-port <port> <server_name> <public_origin>/mcp
   ```

   Give no client secret. The server issues none, because every client is a public client in the
   OAuth sense.

7. Start the client, and let it connect. In Claude Code, run `/mcp`, and pick the server to sign in.

   Expect: the client opens the owner's browser on `/oauth2/authorize`. After the passkey sign-in
   and the consent, the client lists the API's tools, and a tool call returns rows.

## Revoke access

- To end one grant:
  1. Run `bun <api_entry> grants`. Expect: each grant, with its ID, its client, its scopes and when
     it was last used.
  2. Run `bun <api_entry> grants --revoke=<grant_id>`. Expect: `Revoked grant <grant_id>`, and the
     grant's tokens fail on their next request.
- To end every grant of a client and remove the client:
  1. Run `bun <api_entry> clients`. Expect: each client, with its ID and its name.
  2. Run `bun <api_entry> clients remove <name>`. Expect: the count of grants it revoked, and the
     client's tokens fail on their next request. When two clients have names that read the same, the
     command removes neither and lists their IDs. Run
     `bun <api_entry> clients remove --id <client_id>` with the ID of the one to remove.
- To replace a lost or stolen passkey:
  1. Run `bun <api_entry> passkeys enroll --reset`. Expect: a new enrollment token. The command
     deletes every passkey, and keeps every grant.
  2. Enroll the new passkey with step 3 of [Add a client](#3-add-a-client).
  3. Run `bun <api_entry> grants`. `grants` shows no time a grant was made, so revoke every grant
     that the owner can't account for. When in doubt, revoke every grant, and connect each client
     again, as in step 7 of [Add a client](#3-add-a-client).
