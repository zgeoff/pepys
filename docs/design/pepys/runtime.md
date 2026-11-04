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

The bucket backup copies the facts and blobs buckets to an R2 bucket with `rclone copy`, which never
deletes a copied object, as [storage](./storage.md#garage) requires.

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

| Command group                | Served by  | Reached at                        | Defined in                                                |
| ---------------------------- | ---------- | --------------------------------- | --------------------------------------------------------- |
| `pepys preview <consumer>`   | the host   | a port on 127.0.0.1 in the pod    | [host](./host.md#preview-and-up)                          |
| `pepys up <consumer>`        | the host   | a port on 127.0.0.1 in the pod    | [host](./host.md#preview-and-up)                          |
| `pepys clients`              | the API    | a port on 127.0.0.1 in the pod    | [auth](./auth.md)                                         |
| `pepys passkeys`             | the API    | a port on 127.0.0.1 in the pod    | [auth](./auth.md)                                         |
| `pepys grants`               | the API    | a port on 127.0.0.1 in the pod    | [auth](./auth.md)                                         |
| `pepys preview enrich <job>` | enrichment | the admin port of its k3s Service | [enrichment](./enrichment.md#job-versions)                |
| `pepys up enrich <job>`      | enrichment | the admin port of its k3s Service | [enrichment](./enrichment.md#job-versions)                |
| `pepys sample enrich <job>`  | enrichment | the admin port of its k3s Service | [architecture](./architecture.md#champion-and-challenger) |

The host is Rust, so it serves its admin routes as JSON over HTTP, at the method and path each
procedure in the contract declares. The CLI calls them through oRPC's `OpenAPILink`, which calls any
OpenAPI server from a contract. Whoever builds the host's admin routes writes their Rust types by
hand, and a contract test runs the CLI's client against the host, so a route that drifts from the
contract fails the test.

The admin routes never check a token. Only a process inside the pod reaches the host and API admin
ports, and an operator gets inside the pod only with the cluster credentials that `kubectl exec`
needs. A NetworkPolicy opens enrichment's admin port only to the pod that runs the host and the API.

## Secrets

Each runtime secret has an item in the 1Password vault `cloud`, a copy in `cloud-deploy` for the
apply job, and a reference in the cloud repository's `.env`. Pulumi turns each item into a
Kubernetes Secret that only its process mounts, as every geoff.cloud workload receives its secrets
([cloud secrets](https://github.com/zgeoff/cloud/blob/main/docs/architecture/secrets.md)). The apply
job refuses a reference to any other vault, so the `pepys` vault holds only the copies that
development on the owner's machine reads. Each item in the table is named `pepys-<item>` in `cloud`.

| Item               | Fields                                        | Mounted by   |
| ------------------ | --------------------------------------------- | ------------ |
| `github-app`       | `client-id`, `private-key`, `webhook-secret`  | ingest       |
| `gmail`            | `client-id`, `client-secret`, `refresh-token` | ingest       |
| `jev`              | `credential`                                  | enrichment   |
| `owner-identity`   | `emails`, `github-user-id`                    | ingest       |
| `garage-<service>` | the access key and secret of one service      | that service |

The owner creates each Garage key once with the Garage CLI, scoped to the buckets in the
[storage](./storage.md#buckets-and-keys) table, and stores it in `cloud` as
`pepys-garage-<service>`. Each process reads its secrets at start, so a rotation reaches it after
the next rollout.

## Network

Every pepys port is cluster-only except two routes.

- **The GitHub webhook** enters through the cloud repository's shared Cloudflare tunnel. The tunnel
  rule matches the one path `/webhook/github` on `pepys-webhook.geoff.cloud` and sends it to
  ingest's Service. The route's exposure registry entry names its auth layer: ingest checks the
  webhook signature before it writes anything ([ingest](./ingest.md#github)).
- **The API** answers on the tailnet only, at `pepys.geoff.cloud`, a name that points at the
  geoff.cloud server's tailnet address, through its own Traefik ingress in the pattern that serves
  nixie ([nixie](https://github.com/zgeoff/cloud/blob/main/docs/architecture/workloads/nixie.md)).
  The owner's devices reach it as tailnet members.

NetworkPolicies in the namespace refuse every other path in:

- s2-lite admits only its four clients, as the [log](./log.md) requires.
- Garage's S3 port admits only pepys's own pods.
- The API admits only the Traefik ingress, and the host admits nothing from outside its pod.
- Enrichment admits only the pod that runs the host and the API, on its admin port.

Three pods may send traffic to the internet:

- ingest, which calls GitHub and Gmail;
- enrichment, which calls Jev and fetches the git mirrors;
- the bucket backup, which writes to R2.

Every other pod reaches only the namespace.
