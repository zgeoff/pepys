# 0025: The API runs its own OAuth server, and the owner signs in with a passkey

- Date: 2026-11-12
- Status: decided
- Design: [the OAuth server](../architecture/queries/oauth-server.md)

## Decision

The API runs its own OAuth 2.1 authorization server, which gives the owner's MCP clients, such as
Claude Code, their access tokens. The server runs on better-auth, a TypeScript auth library, and
copies its code from the OAuth server of atc, the owner's agent control tower, which runs on
better-auth too.

- The owner is the one user, and a passkey is the one credential that signs the owner in.
- The owner adds each client with the API's `clients add` admin command. A client that the owner
  never added can't start an authorization.
- Each authorization needs a fresh passkey sign-in.

## Rejected alternatives

| Option                                                       | Why not                                                                                                   |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| an outside identity provider                                 | the owner then trusts and keeps up a second system for one user                                           |
| a sign-in code that the owner approves with an API token     | the owner's agent runner, impz, signs in this way, but pepys gives the owner no API token to approve with |
| dynamic client registration, or client ID metadata documents | any client could then start an authorization and put a consent page in front of the owner                 |
| an auth package shared with atc before pepys's server        | the API needs auth before it holds any personal data, so the server can't wait for that package           |

## Why

pepys serves one person, so it needs no user accounts and no outside provider. A passkey works from
each of the owner's devices, and nobody can guess or phish it. atc's server already meets the MCP
authorization spec on better-auth, so a copy starts from code that works.

## Consequences

- When the owner loses every passkey, the owner runs `passkeys enroll --reset` in the API's
  container, and enrols a new passkey.
