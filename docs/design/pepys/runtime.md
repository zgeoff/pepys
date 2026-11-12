# Runtime

pepys runs as one k3s namespace, `pepys`, on the owner's geoff.cloud host. The owner's
[cloud repository](https://github.com/zgeoff/cloud) declares every pepys workload in its Pulumi
program, beside nixie, and pins each pepys image by tag and digest in its stack config. This repo
builds the images and the consumer modules, and changes nothing in the cluster itself.

## Processes

| Process          | k3s object                  | Image        | Volume                                  |
| ---------------- | --------------------------- | ------------ | --------------------------------------- |
| Garage           | StatefulSet, from its chart | Garage's own | metadata and objects, as in [storage]   |
| s2-lite          | Deployment, 1 replica       | s2-lite's    | none: its data is in the facts bucket   |
| ingest           | Deployment, 1 replica       | `pepys`      | none                                    |
| host and the API | StatefulSet, 1 replica      | both images  | the store, shared by the two containers |
| enrichment       | StatefulSet, 1 replica      | `pepys`      | git mirrors and model weights           |
| compaction       | CronJob, daily at 03:00 UTC | `pepys`      | none                                    |
| bucket backup    | CronJob, daily at 04:00 UTC | rclone's     | none                                    |

[storage]: ./storage.md#garage

The host and the API share one pod. The API reads the store files that the host writes, and waits
for the host's commit signal on a local socket, as the [change feed](./change-feed.md) describes.
Two containers in one pod share the store volume and that socket. The host's StatefulSet stops the
old pod before it starts the new one, because the host is the store's one writer.

Each long-running process runs one replica. Ingest holds a lock over its source runs, and enrichment
keeps its mirrors on one disk, so a second replica would only race the first.

The GitHub delivery sweep and the Gmail poll run inside ingest, on the timers of each source's
definition, under the same lock as backfill, recovery and resync. The sweep runs every hour, inside
GitHub's 3-day window ([ingest](./ingest.md#github)). The Gmail poll runs every 60 seconds. The host
copies its snapshots to the snapshots bucket in Garage on its own schedule
([host](./host.md#snapshots)).

The bucket backup copies the facts, blobs and modules buckets to an R2 bucket with `rclone copy`,
which never deletes a copied object, as [storage](./storage.md#garage) requires.

## Images and modules

| Artifact         | Holds                                                                | Built by                             |
| ---------------- | -------------------------------------------------------------------- | ------------------------------------ |
| `pepys-host`     | the host binary                                                      | this repo's release workflow         |
| `pepys`          | Bun with ingest, enrichment, the API, compaction and the `pepys` CLI | this repo's release workflow         |
| consumer modules | each consumer's WebAssembly module, named by its hash                | the same workflow, into `pepys-host` |

The release workflow pushes both images to `ghcr.io/zgeoff/`, as nixie's release does, and the cloud
stack pulls them with the cluster's ghcr pull secret. Each process in the `pepys` image starts from
its own entry file, so one image serves ingest, enrichment, the API and compaction. The CLI is an
entry file too, run by hand.

The release workflow copies each module into the `pepys-host` image under `/modules/<hash>.wasm`.
When `pepys up` deploys a module, the host first writes it to the modules bucket, which keeps every
module a store row names ([storage](./storage.md#buckets-and-keys)). The workflow therefore needs no
route into the cluster.

## The CLI

The `pepys` CLI comes from `@pepys/cli` and ships in the `pepys` image. An operator, the owner or
one of the owner's agents, runs it with `kubectl exec` in the API container. The CLI holds no state.
Each command calls the admin routes of the process that owns what the command changes, through an
oRPC client built from the admin contract in `@pepys/contract`.

`<consumer>` is a consumer's declared name, and `<job>` is an enrichment job's name. The design doc
in the last column defines each command.

| Command                          | Served by  | Reached at                        | Defined in                                                |
| -------------------------------- | ---------- | --------------------------------- | --------------------------------------------------------- |
| `pepys preview <consumer>`       | the host   | a port on 127.0.0.1 in the pod    | [host](./host.md#preview-and-up)                          |
| `pepys up <consumer>`            | the host   | a port on 127.0.0.1 in the pod    | [host](./host.md#preview-and-up)                          |
| `pepys rebuild <consumer>`       | the host   | a port on 127.0.0.1 in the pod    | [history](./history.md#the-lake)                          |
| `pepys preview enrich <job>`     | enrichment | the admin port of its k3s Service | [enrichment](./enrichment.md#job-versions)                |
| `pepys up enrich <job>`          | enrichment | the admin port of its k3s Service | [enrichment](./enrichment.md#job-versions)                |
| `pepys sample enrich <job>`      | enrichment | the admin port of its k3s Service | [architecture](./architecture.md#champion-and-challenger) |
| `pepys ingest backfill <source>` | ingest     | the admin port of its k3s Service | [ingest](./ingest.md#what-every-source-does)              |
| `pepys ingest recover <source>`  | ingest     | the admin port of its k3s Service | [ingest](./ingest.md#what-every-source-does)              |
| `pepys ingest resync <source>`   | ingest     | the admin port of its k3s Service | [ingest](./ingest.md#what-every-source-does)              |

The host is Rust, so it serves its admin routes as JSON over HTTP, at the method and path each
procedure in the contract declares. The CLI calls them through oRPC's `OpenAPILink`, which calls any
OpenAPI server from a contract. Whoever builds the host's admin routes writes their Rust types by
hand, and a contract test runs the CLI's client against the host, so a route that drifts from the
contract fails the test.

The API's own admin commands, such as `clients add` and `passkeys enroll`, run through the API's
entry in its container, not through the CLI, as
[the OAuth server](../api-auth/oauth.md#the-api-process) sets out.

The admin routes never check a token. An operator gets inside the pod only with the cluster
credentials that `kubectl exec` needs. The host's admin port, enrichment's admin port and ingest's
admin port each admit one other pod, as [network](#network) lists.

## Secrets

Each runtime secret has an item in the 1Password vault `cloud`, a copy in `cloud-deploy` for the
apply job, and a reference in the cloud repository's `.env`. Pulumi turns each item into a
Kubernetes Secret that only its process mounts, as every geoff.cloud workload receives its secrets
([cloud secrets](https://github.com/zgeoff/cloud/blob/main/docs/architecture/secrets.md)). The apply
job refuses a reference to any other vault, so the `pepys` vault holds only the copies that
development on the owner's machine reads. Each item in the table is named `pepys-<item>` in `cloud`.

| Item                | Fields                                        | Mounted by                                                    |
| ------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| `github-app`        | `client-id`, `private-key`, `webhook-secret`  | ingest                                                        |
| `github-read-token` | `token`                                       | enrichment                                                    |
| `gmail`             | `client-id`, `client-secret`, `refresh-token` | ingest                                                        |
| `jev`               | `credential`                                  | enrichment                                                    |
| `api-owner-pc`      | `token`                                       | the API, as its digest; the owner's script reads it on the PC |
| `api-boxxy`         | `token`                                       | the API, as its digest; the boxxy server                      |
| `owner-identity`    | `emails`, `github-user-id`                    | ingest                                                        |
| `garage-<service>`  | the access key and secret of one service      | that service                                                  |

The owner creates each Garage key once with the Garage CLI, scoped to the buckets in the
[storage](./storage.md#buckets-and-keys) table, and stores it in `cloud` as
`pepys-garage-<service>`. Each process reads its secrets at start, so a rotation reaches it after
the next rollout.

Enrichment clones the owner's private repositories with `pepys-github-read-token`, a fine-grained
GitHub personal access token with `contents: read` on the owner's repositories. The GitHub App's key
stays with ingest alone. The owner creates and rotates the token by hand.

## Network

Every pepys port is cluster-only except three routes.

- **The GitHub webhook** enters through the cloud repository's shared Cloudflare tunnel. The tunnel
  rule matches the one path `/webhook/github` on `pepys-webhook.geoff.cloud` and sends it to
  ingest's Service. The route's exposure registry entry names its auth layer: ingest checks the
  webhook signature before it writes anything ([ingest](./ingest.md#github)).
- **The API's public listener** serves `/mcp` and the sign-in pages through the same tunnel, behind
  the API's own OAuth server, with a Cloudflare Access login in front of the sign-in pages.
- **The API's tailnet listener** serves `/rpc` on a NodePort that answers on the server's tailnet
  address only, to the owner's PC with a service token.

[Auth for the API](../api-auth/README.md#deployment-changes) lists the Services, NetworkPolicies and
exposure registry entries of the two API routes.

Inside the namespace, enrichment and the pod that runs the host and the API call each other on three
internal ports. No internal route checks a token, as with the CLI's admin routes.

| Port                                      | Serves                                                                              | Open to                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------- |
| the API's internal port                   | change feed reads and search                                                        | the enrichment pod                     |
| the host's admin port, on the pod address | the host's admin routes                                                             | the enrichment pod                     |
| enrichment's internal port                | the embed route, which embeds a search question with the champion embedding version | the pod that runs the host and the API |

NetworkPolicies in the namespace refuse every other path in:

- s2-lite admits only its five clients, as the [log](./log.md) requires.
- Garage's S3 port admits only pepys's own pods.
- The API admits cloudflared on its public port, the owner's PC on its tailnet port, the boxxy
  server on its cluster port, and the enrichment pod on its internal port.
- The host admits only the enrichment pod, on its admin port.
- Enrichment admits only the pod that runs the host and the API, on its admin port and its internal
  port.
- Ingest admits the tunnel's traffic on its webhook port, and the pod that runs the host and the API
  on its admin port.

Three pods may send traffic to the internet:

- ingest, which calls GitHub and Gmail;
- enrichment, which calls Jev and fetches the git mirrors;
- the bucket backup, which writes to R2.

Every other pod reaches only the namespace.
