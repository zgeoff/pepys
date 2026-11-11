# Spikes

A spike is a throwaway experiment that answers one research question for the
[pepys design](../docs/design/pepys/README.md). Each folder here holds one spike as its own Bun
package, named `@pepys/spike-<folder>` and pinned to the exact versions it ran against. Each spike
takes the shape that the
[Spikes section of the shared docs-writing skill](https://github.com/zgeoff/tools/blob/main/sync/skills/docs-writing/references/docs-tree.md#spikes)
sets. Its README is a landing page with the question, the answer, the run command and what it left
untested. Its `results.md` holds the full report: the method, the check it must pass, the setup and
versions, every result and the full untested list.

The root workspace installs the spikes. A spike with code has a `typecheck` script, and the root
`typecheck` runs it, so a spike that a later design reruns still compiles. CI runs no spike and no
spike test, and a lint rule stops product code from importing a spike.

A spike is deleted once its finding sits in the design or architecture doc that owns it. A doc that
cites a deleted spike links the commit that last held it.

| Spike                                 | What it answers                                                             |
| ------------------------------------- | --------------------------------------------------------------------------- |
| [source-retention](source-retention/) | how long GitHub keeps webhook deliveries and a Gmail history ID stays valid |
