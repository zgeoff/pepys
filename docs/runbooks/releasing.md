# Releasing

Use this runbook to release a version of pepys: every public package to npm, and the host binary to
a GitHub release, under one version. The release workflow, `.github/workflows/release.yml`, does the
packing, the publishing and the binary. This runbook holds the steps it leaves to a person, and what
to do when a run of it fails.

## Release a version

1. In one pull request, set the new version in the `package.json` of every public package, and write
   `bun.lock` with the pinned Bun.
2. After the pull request merges, push the tag `v<version>` on `main`.

   Expect: `release.yml` checks the tag against each version, packs each package once, installs the
   tarballs outside the repo, publishes them to npm with provenance, and makes the GitHub release of
   the tag with `pepys-host-linux-x64` and `SHA256SUMS`.

3. Check the release from outside the repo: run `bun run test:e2e:outside` with
   `PEPYS_OUTSIDE_VERSION=<version>` and `PEPYS_OUTSIDE_HOST_TAG=v<version>`, and with
   `PEPYS_ZIG_BIN` and `PEPYS_WASM_TOOLS_BIN` set.

   Expect: the check installs the version from npm, downloads the release's binary, checks it
   against `SHA256SUMS`, and runs a stub deployment until each consumer is current.

A package that has never been on npm needs a first publish by the owner, and npm's trusted publisher
set for `release.yml`, before CI can publish it.

## When a run fails

A second run of one tag never changes a published release. When the tag already has a release, the
`release-host` job downloads its two files and passes only when they match what it built.

- **The job reports that the files disagree.** Delete the release of that tag on GitHub, then run
  the job again.
- **A run stopped during its upload.** The job uploads both files to a draft and publishes the draft
  last, so a cut-off run leaves a draft that no deploy can download. Run the job again: it deletes
  the draft and makes the release again.
- **The job reports a glibc symbol newer than 2.35.** A dependency or the toolchain now needs a
  newer glibc than the oldest image a deploy may run, as
  [deploying](./deploying.md#3-fetch-the-host) sets out, and the job makes no release. Find the
  change that raised it before you run the job again.
