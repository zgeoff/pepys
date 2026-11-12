# Deploying a deployment

Use this runbook to run a pepys deployment from the published packages and the released host binary.
It builds the deployment's consumers, fetches and checks the host, and starts s2-lite, ingest, the
host and the API in the order each one needs. pepys publishes no image, so the repo that holds the
deployment builds its own images from these steps.
[The architecture overview](../architecture/overview.md#topology) shows how the processes reach each
other.

You need Bun, zig 0.16.0 and wasm-tools 1.262.0 for the build, an s2-lite server whose data lives in
an object storage bucket, and a host that runs a glibc of 2.35 or later.

## 1. Write the deployment

1. Add the packages: `bun add @pepys/kit @pepys/ingest @pepys/api @pepys/cli` and each plug-in you
   list, such as `@pepys/source-github`. Pin every `@pepys/*` package to one version.
2. Write a deployment file that exports one deployment, with `defineDeployment({ name, plugins })`.
3. Write two entry files. One calls `serveIngest({ deployment, environment: process.env })` from
   `@pepys/ingest`, and the other calls `serveAPI({ deployment, environment: process.env })` from
   `@pepys/api`.

## 2. Build the consumers

Build in a fixed folder, such as the work folder of the image, because scriptc builds the entry's
absolute path into each module, and a build in another folder gives every consumer a new version.

1. Set `PEPYS_ZIG_BIN` and `PEPYS_WASM_TOOLS_BIN` to the two tools, or put them on `PATH`.
2. Run `bunx pepys build <deployment-file> --out <build-folder>`.

   Expect: `<build-folder>/consumers.json` and one `<consumer>/<hash>.wasm` for each consumer.

## 3. Fetch the host

Each release `v<version>` carries the host as `pepys-host-linux-x64`, beside a `SHA256SUMS` file
with one line for it.

1. Download both files of the release whose version matches your `@pepys/*` packages into one
   folder.
2. Run `sha256sum -c SHA256SUMS` in that folder.

   Expect: `pepys-host-linux-x64: OK`.

3. Run `chmod +x pepys-host-linux-x64`.

The binary links the glibc of the runner that built it, glibc 2.35, and needs `libgcc_s.so.1`. It
runs on `ubuntu:22.04`, `ubuntu:24.04` or `debian:bookworm`. It never runs on musl, such as Alpine,
or on `debian:bullseye`, which has glibc 2.31.

## 4. Start the processes

**CAUTION:** Run one host and one ingest process per deployment. The host is the store's one writer,
and each ingest process keeps its recent bodies and resync marks in its own memory.

1. Start s2-lite. Ingest, the host and the API each need its endpoint, its access token and the
   basin name.
2. Start ingest with `PEPYS_S2_ENDPOINT`, `PEPYS_S2_ACCESS_TOKEN`, `PEPYS_S2_BASIN`, and every
   secret that a plug-in's route or pull needs, such as the three `PEPYS_GITHUB_` settings. Set
   `PEPYS_INGEST_HOST` to the address the routes must answer on, because it defaults to 127.0.0.1.

   Expect: ingest names every missing setting and exits 1, or listens on `PEPYS_INGEST_PORT`, 8080
   by default.

3. Start the host with `pepys-host-linux-x64 run --up`, with the three `PEPYS_S2_` settings,
   `PEPYS_STORE_DIR` set to the store folder, and `PEPYS_CONSUMERS` set to
   `<build-folder>/consumers.json`.

   Expect: the host deploys each listed consumer in file order, then applies facts. A failed `up`
   stops the start, with the consumer's name.

4. Start the API with `PEPYS_STORE_DIR` set to the same store folder, and `PEPYS_API_HOST` and
   `PEPYS_API_PORT` set as for ingest. The port defaults to 8081.

   Expect: a `get_entity` call for an ID with no row answers not found. A query whose consumer has
   no current version answers 503.

The API checks no token, so the deployment's network rules decide who reaches it. Open to the public
internet only the routes that carry the public reach mark, such as `/webhook/github`.

## Deploy a new consumer version

1. Build again, in the same folder.
2. Restart the host with `run --up`, or run `pepys-host-linux-x64 up <consumer>` beside the running
   host.

   Expect: the host replays the new version beside the live one and swaps it in. The API reads the
   new version from its next call.

To go back, run `pepys-host-linux-x64 up <consumer> --version <version>` with the previous version's
hash. The host catches that version up from its own offsets and swaps it back in.
