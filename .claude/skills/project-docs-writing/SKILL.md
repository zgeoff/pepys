---
name: project-docs-writing
description:
  pepys's own rules for repo prose, on top of the shared docs-writing skill: spikes live under
  research/ and are deleted once their finding has a home. Load together with docs-writing whenever
  you write, edit, or review prose in this repo.
---

# pepys docs writing

Load the shared `docs-writing` skill first. This skill holds only what pepys adds to it, and where
the two disagree, this one wins.

## Spikes

A design's evidence lives in a spike under `research/<name>/`, not in `docs/design/<work>/spikes/`.
[research/README.md](../../../research/README.md) holds the spike layout and the index. A design doc
links the spike instead of repeating its numbers or its method.

A spike is deleted once its finding sits in the design or architecture doc that owns it. A link that
cites a deleted spike points at the commit that last held it.
