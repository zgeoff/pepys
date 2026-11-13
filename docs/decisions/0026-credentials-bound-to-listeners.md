# 0026: Each credential works only on the listeners it is bound to

- Date: 2026-11-12
- Status: decided
- Design: [auth for the API](../design/api-auth/README.md#service-tokens-and-listeners)

## Decision

The API serves its routes on three listeners, each one an address and port of its own. Each listener
takes one kind of credential:

| Listener | Caller                                                                  | Credential                                      |
| -------- | ----------------------------------------------------------------------- | ----------------------------------------------- |
| public   | the owner's MCP clients, through a Cloudflare tunnel                    | an OAuth access token from the API's own server |
| tailnet  | a script on the owner's PC, over the owner's Tailscale network          | a service token                                 |
| cluster  | other pods in the k3s cluster that runs pepys, such as the boxxy server | a service token                                 |

A service token is a long random string that one caller holds. The API reads the tokens' SHA-256
digests from a callers file, and the owner lists in that file the listeners each caller's tokens
work on. The API reloads the file when it changes, without a restart.

Every query on every listener needs a credential, whatever address the listener binds. The sign-in
pages, the OAuth endpoints and the health check take none: a client calls the first two to get its
first token, and the health check reads nothing.

## Rejected alternatives

| Option                                                        | Why not                                                                                      |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| two listeners, with the tailnet route on the cluster listener | a leaked token of a pod then works from the tailnet, and a leaked token of the PC from a pod |
| service tokens in an environment variable, read once at start | a revocation then restarts the pod, and the pod also runs the host, the store's one writer   |
| network policies and the tailnet as the only check            | a network policy never stops a process on the cluster's node                                 |

## Why

A leaked credential opens only the listener its caller uses. A leaked token of a pod opens nothing
from the tailnet, and a leaked token of the PC opens nothing from a pod. Each caller holds its own
tokens, so revoking one caller's token leaves every other caller working.

A pod can't sign in with a passkey and doesn't come from the PC's tailnet address, so pods get the
cluster listener.

A credential on every query guards against a process on the cluster's node. A network policy never
stops such a process, and it reaches every listener.

## Consequences

- Tests and local runs write a callers file and send a token.
- A new caller needs its own entry in the callers file. A caller that reaches the API another way,
  such as from a second network, needs a new listener.
