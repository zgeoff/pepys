# Deploying pepys

Use this runbook to run pepys from the published `@pepys/*` packages and the released host binary.
You write a deployment, a TypeScript file that lists the plug-ins to run. Each plug-in brings
consumers, the code that turns facts into tables. You build each consumer into a WebAssembly module,
fetch the host, and start s2-lite, ingest, the host and the API. pepys publishes no image, so you
build your own images from these steps.
[The architecture overview](../architecture/overview.md#topology) shows how the processes reach each
other.

You need:

- Bun, zig 0.16.0 and wasm-tools 1.262.0, for the build;
- an s2-lite server, the self-hosted server of the S2 stream API, and the access token it takes;
- an object storage bucket for s2-lite's data, such as one on Garage, an S3-compatible store;
- for the host binary, a machine with glibc 2.35 or later and `libgcc_s.so.1`, as
  [3. Fetch the host](#3-fetch-the-host) lists.

## 1. Write the deployment

1. Add the packages, each at the same exact version:

   ```sh
   bun add --exact @pepys/kit @pepys/ingest @pepys/api @pepys/cli @pepys/source-github
   ```

   Replace `@pepys/source-github` with the plug-ins you run.

2. Write a deployment file that exports the value of `defineDeployment({ name, plugins })` from
   `@pepys/kit`, under any name or as the default export. Put in `plugins` each plug-in that its
   package exports, such as `githubPlugin` from `@pepys/source-github`.
3. Write an ingest entry file that calls `serveIngest({ deployment, environment: process.env })`
   from `@pepys/ingest`.
4. Write an API entry file that calls `serveAPI({ deployment, environment: process.env })` from
   `@pepys/api`.

## 2. Build the consumers

Choose one absolute `<build-folder>`, such as a fixed folder in the image, and build into it every
time. The compiler writes the folder's path into each consumer's `.wasm` file, so a build into
another folder gives every consumer a new hash. The host treats a new hash as a new version, and
replays it from the first fact in the log.

1. Set `PEPYS_ZIG_BIN` and `PEPYS_WASM_TOOLS_BIN` to the two tools, or put the tools on `PATH`.
2. Run the build:

   ```sh
   bunx pepys build <deployment-file> --out <build-folder>
   ```

   Expect: `<build-folder>/consumers.json` and one `<consumer>/<hash>.wasm` for each consumer.

## 3. Fetch the host

Each release `v<version>` on the [pepys releases page](https://github.com/zgeoff/pepys/releases)
carries the host as `pepys-host-linux-x64`, beside a `SHA256SUMS` file with one line for it.

1. Download both files of the release whose version matches your `@pepys/*` packages into one
   folder.
2. Run `sha256sum -c SHA256SUMS` in that folder.

   Expect: `pepys-host-linux-x64: OK`.

3. Run `chmod +x pepys-host-linux-x64`.

The binary links glibc 2.35, the glibc of the CI runner that builds it, and needs `libgcc_s.so.1`.
It runs on `ubuntu:22.04`, `ubuntu:24.04` or `debian:bookworm`. It never runs on musl, such as
Alpine, or on `debian:bullseye`, which has glibc 2.31.

## 4. Start the processes

Start the processes in the order of the steps. Ingest creates the S2 basin, S2's name for a group of
streams, and the fact streams when it starts, and the host reads those streams.

**CAUTION:** The API checks no token, so anyone who reaches its port reads every row. Keep the API
port on a private network. Open to the public internet only the ingest routes that a plug-in
declares with `reach: 'public'`. Of the plug-ins in this repo, only the GitHub plug-in has one,
`/webhook/github`.

**CAUTION:** Run one ingest process at a time. To restart ingest, stop the old process before you
start the new one. Each ingest process remembers, in its own memory, the deliveries it stored in the
last hour and the entities it marked for a
[resync pull](../architecture/plug-ins/github.md#the-resync-pull). With two processes, a repeated
delivery adds a second copy of its facts to the log, and one process's resync pull misses the
other's marks.

1. Start s2-lite.
2. Set these variables for ingest:
   - `PEPYS_S2_ENDPOINT`, the URL of s2-lite with its scheme, such as `http://127.0.0.1:8090`;
   - `PEPYS_S2_ACCESS_TOKEN`, the token s2-lite takes;
   - `PEPYS_S2_BASIN`, a basin name you choose, such as `pepys`;
   - each secret that a plug-in needs, such as the settings in
     [the GitHub plug-in's route and settings](../architecture/plug-ins/github.md#the-route-and-the-settings);
   - `PEPYS_INGEST_HOST`, the address that the routes answer on, which defaults to 127.0.0.1;
   - `PEPYS_INGEST_PORT`, which defaults to 8080.
3. Start ingest with `bun <ingest-entry-file>`.

   Expect: ingest listens on its port. When a setting is missing, ingest prints the name of each
   missing setting and exits 1.

4. Set these variables for the host:
   - the three `PEPYS_S2_` variables, with the same values as for ingest;
   - `PEPYS_STORE_DIR`, set to `<store-folder>`, which the host makes when it is missing;
   - `PEPYS_CONSUMERS`, set to `<build-folder>/consumers.json`.

   Keep `<store-folder>` on a disk that lasts across restarts. The host writes the files there while
   the API reads them, so run both processes on one machine.

5. Start the host with `pepys-host-linux-x64 run --up`.

   Expect: the host deploys each consumer of `consumers.json` in file order, then applies new facts
   until it stops. `<store-folder>/<consumer>/current` links to the folder of each consumer's
   current version. When one deploy fails, the host prints `pepys: ` and the error, with the
   consumer's name, and exits 1.

6. Set `PEPYS_STORE_DIR` for the API to `<store-folder>`. The API reads no S2 setting.
   `PEPYS_API_HOST` defaults to 127.0.0.1, and `PEPYS_API_PORT` defaults to 8081.
7. Start the API with `bun <api-entry-file>`.

   Expect: the API listens on its port. Until a consumer has a current version, each query that
   reads that consumer's tables returns HTTP 503. The [API README](../../packages/api/README.md)
   shows a typed client to call a query.

## Deploy a change

Find the steps for what you changed.

| You changed                                             | Do                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| a consumer, or a plug-in setting in the deployment file | [Deploy new consumer versions](#deploy-new-consumer-versions) |
| an ingest variable, such as a plug-in's secret          | stop ingest, set the variable, and start ingest again         |
| the `@pepys/*` version                                  | [Upgrade the packages](#upgrade-the-packages)                 |

A plug-in setting in the deployment file reaches each consumer at build time, so a changed setting
gives that consumer a new hash.

### Deploy new consumer versions

1. Build again into the same `<build-folder>`.
2. To keep the host running, run `pepys-host-linux-x64 up` with the host's variables. Otherwise,
   restart the host with `run --up`.

   Expect: one line for each consumer of `consumers.json`. A consumer with a new hash prints
   `<consumer> <hash>: swapped`, and the API reads its new version from its next call. A consumer
   whose hash did not change prints `no swap, the version is current`.

   `up` replays each new version beside the live one without the consumer's writer lock. To swap the
   new version in, `up` then waits up to 30 seconds for the lock. When `up` cannot get the lock, it
   fails, and the live version stays current. Run `up` again.

### Upgrade the packages

1. Add the new version of each `@pepys/*` package, as in
   [1. Write the deployment](#1-write-the-deployment).
2. Build again into the same `<build-folder>`.
3. Fetch the host of the new release, as in [3. Fetch the host](#3-fetch-the-host).
4. Stop ingest, and start it again on the new packages.
5. Stop the host, and start the new binary with `run --up`.
6. Stop the API, and start it again on the new packages.

   Expect: the same results as in [4. Start the processes](#4-start-the-processes).

### Go back to an earlier version

The host keeps the folder of each version it swaps out, in `<store-folder>/<consumer>/<hash>/`.

1. Find the hash of the earlier version among the folder names in `<store-folder>/<consumer>/`.
2. Run `pepys-host-linux-x64 up <consumer> --version <hash>` with the host's variables.

   Expect: `<consumer> <hash>: swapped`. The host catches that version up from its own offsets.

3. Build the earlier code into the same `<build-folder>`.

   Expect: `consumers.json` holds `<hash>` for the consumer again. Until it does, the next
   `run --up` or `up` swaps the later version back in.
