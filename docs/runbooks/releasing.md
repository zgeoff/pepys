# Releasing

Use this runbook to release a version of pepys. A version is every public package on npm, plus the
host binary on the GitHub release of the version's tag. The host is the Rust process that runs a
deployment, as the [architecture overview](../architecture/overview.md) describes. The release
workflow, `.github/workflows/release.yml`, packs, publishes and builds. You do the steps below, and
you act when one of the workflow's jobs fails.

In this runbook, `<version>` is the version number with no leading `v`, such as `0.4.0`.

## Release a version

1. Open one pull request that sets `"version": "<version>"` in the `package.json` of each public
   package. [Packages in AGENTS.md](../../AGENTS.md#packages) lists the public packages.
2. Install the Bun version in `.bun-version`.
3. In the same pull request, run `bun install`, and commit the `bun.lock` it writes.
4. Merge the pull request.
5. Tag the merge commit `v<version>`.
6. Push the tag.

   Expect: the `release` workflow run for the tag goes green. npm lists each public package at
   `<version>`. The GitHub release `v<version>` holds `pepys-host-linux-x64` and `SHA256SUMS`.

7. Make sure that Docker runs, `PEPYS_ZIG_BIN` points at zig 0.16.0, and `PEPYS_WASM_TOOLS_BIN`
   points at wasm-tools 1.262.0.
8. Check the release outside the repo:

   ```bash
   PEPYS_OUTSIDE_VERSION=<version> PEPYS_OUTSIDE_HOST_TAG=v<version> bun run test:e2e:outside
   ```

   Expect: the script exits 0. The script installs the packages from npm into an empty folder,
   downloads the binary, checks the binary against `SHA256SUMS`, and runs a small deployment of its
   own on it.

When step 8 fails, the version is already on npm and GitHub. Fix the cause on `main`, and release
the next version.

## Publish a new package for the first time

CI publishes only a package that npm already has. Before you release a version that adds a public
package, ask a person with publish rights on the `@pepys` npm scope to do these steps:

1. From the package's folder, run `npm publish --access public`.

   Expect: npm lists the package.

2. On the package's settings page on npmjs.com, add a trusted publisher of type GitHub Actions, with
   this repo and the workflow file `release.yml`. npm's
   [trusted publishing](https://docs.npmjs.com/trusted-publishers) page shows the form.

## When a job fails

The workflow runs two jobs on each tag, and neither waits for the other:

- **release to npm** publishes the packages.
- **release-host** builds the binary and makes the GitHub release.

One job can fail while the other succeeds. A version can then reach npm with no binary, or GitHub
with no packages.

To re-run a job, open the workflow run of the tag in GitHub Actions, and re-run the failed job. A
re-run uses the same tagged commit, so it fixes only a cause outside the repo, such as an npm
outage. When the cause is in the code, fix it on `main`, and release the next version. npm never
takes a second publish of one version. Leave the broken version as it is.

### Every job reports a version mismatch

Both jobs check the tag against each `package.json` before they publish anything, so a mismatch
publishes nothing.

1. Delete the tag on GitHub and in your clone.
2. Tag the commit whose `package.json` files carry `<version>`.
3. Push the tag.

### release to npm fails

When the cause is outside the repo, re-run the job. The re-run skips each package that npm already
has at `<version>`, and publishes the rest.

### release-host fails

- **The job stopped during its upload.** The job uploads both files to a draft release, and
  publishes the draft last. A cut-off run therefore leaves only a draft, which no deploy can
  download. Re-run the job. The re-run deletes the draft and makes the release again.
- **The job reports that `pepys-host-linux-x64` needs a glibc newer than 2.35.** The job makes no
  release. Every deploy host runs glibc 2.35 or later, as
  [Fetch the host](./deploying.md#3-fetch-the-host) sets out, and a dependency or toolchain update
  raised what the binary needs. Find that update in the commits since the last release, such as a
  bump in `Cargo.lock` or `rust-toolchain.toml`. Undo or replace the update on `main`, and release
  the next version.
- **On a re-run, the job reports that the release's files differ from its new build.** An earlier
  run of the tag published the release, and a rebuild does not always give the same bytes. The
  published files stay as they are, and deploys keep using them, so leave the release.

  > **CAUTION:** while the release is deleted, every deploy that fetches this version fails. Delete
  > the release only when its files are broken, such as when a deploy's `sha256sum -c SHA256SUMS`
  > fails.

  To replace broken files, delete the GitHub release of the tag. Then re-run the job.
