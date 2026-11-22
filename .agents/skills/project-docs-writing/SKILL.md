---
name: project-docs-writing
description:
  pepys's own rules for repo prose, on top of the shared docs-writing skill. Spikes live under
  research/ and are deleted once their finding has a home. Load together with docs-writing whenever
  you write, edit, or review prose in this repo.
---

# pepys docs writing

Load the shared `docs-writing` skill first, then follow the rules below as well. Where the two
disagree, follow the rules below.

## Spikes

Put a design's evidence in a spike under `research/<name>/`, never in `docs/design/<work>/spikes/`.
A design folder is deleted once its code is built, and a spike in `research/` stays until its
finding has a home.

- Give the spike the README and `results.md` shape in the
  [Spikes section of docs-writing's docs-tree reference](../docs-writing/references/docs-tree.md#spikes).
- Add a row for the spike to the table in [research/README.md](../../../research/README.md).
- In a design doc, link the spike instead of repeating its numbers or its method, so each number has
  one owner. Link `results.md` when you cite a measurement.

Delete the spike once its finding sits in the design or architecture doc that owns it. Then point
each link that cites the spike at the commit that last held it.
