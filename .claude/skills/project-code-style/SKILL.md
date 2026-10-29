---
name: project-code-style
description:
  The place for pepys's additions to the shared code-style skill. They cover pure consumers that
  return operations, branded IDs, and the ID string form. Load beside code-style before writing,
  reviewing, or renaming any TypeScript in pepys.
---

# pepys code style

The shared `code-style` skill holds the module layout, the acronym rule, and the role table of
function verbs. This skill holds only what pepys adds to it, and it never relaxes a rule there.

## Consumers

- A consumer is a pure function with no I/O. It takes facts and returns a list of operations, and
  the host applies them. It reads no clock, no random source, no network, and no file.
- A consumer returns operations rather than writing a row, so the same facts always give the same
  list.

## IDs

- Brand every ID with type-fest `Tagged`, and build one with `toTagged` from `@zgeoff/std`. A bare
  `string` never stands for an ID.
- Consumer code is the exception: scriptc refuses a type-fest import, even a type-only one, so a
  consumer brands IDs with a local brand type.
- Write an ID string as `<source>:<kind>:<id>`, such as `github:pr:1874433021`. The source and the
  kind are lowercase, and the last part is the source's own database ID.
