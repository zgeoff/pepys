---
name: project-testing
description:
  pepys's test facts on top of the shared testing skill: how a consumer test feeds facts and
  asserts operations, and which test regime applies. Load together with the testing skill when
  designing, writing, or reviewing pepys tests.
---

# pepys testing

The shared testing skill holds every rule. This skill holds only the facts of pepys that a test
author needs to follow those rules here.

## The regime

The regime is Pure until a package owns a store. Tests of a pure function need no database, no
network, and no temporary directory.

## Consumer tests

- Feed the consumer inline facts, written in the test beside the assertion.
- Assert the full returned operation list with `toStrictEqual`, never a single field of one
  operation, so an extra or missing operation fails the test.
