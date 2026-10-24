# Spikes

A spike is a throwaway experiment that answers one research question for the
[pepys design](../docs/design/pepys/README.md). Each folder here holds one spike as its own Bun
package, named `@pepys/spike-<folder>` and pinned to the exact versions it ran against. Its README
gives the question, the method, the check it must pass, how to run it, the result and what it left
untested.

The root workspace installs the spikes. A spike with code has a `typecheck` script, and the root
`typecheck` runs it, so a spike that a later design reruns still compiles. CI runs no spike and no
spike test, and a lint rule stops product code from importing a spike.

A spike is deleted once its finding sits in the design or architecture doc that owns it.

| Spike                                                       | What it answers                                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [scriptc-wasm](scriptc-wasm/)                               | whether a scriptc consumer runs under wasmtime with every import denied, matching Bun  |
| [turso-bindings](turso-bindings/)                           | the Turso binding's API, read-only attach of 30 files, and full-text and vector search |
| [s2-lite-durability](s2-lite-durability/)                   | whether s2-lite keeps every acknowledged append through a crash, and its retention     |
| [orpc-elysia-v2](orpc-elysia-v2/)                           | whether oRPC's Elysia adapter works with Elysia v2, and which oRPC major it needs      |
| [leaf-ir-bun](leaf-ir-bun/)                                 | whether LEAF-IR runs under Bun, and the time of one embedding on the k3s server        |
| [mime-parsers](mime-parsers/)                               | whether `postal-mime` or `mailparser` extracts better plain text under Bun             |
| [durable-streams-conformance](durable-streams-conformance/) | whether a Bun server over a Turso change log passes the read conformance tests         |
| [source-retention](source-retention/)                       | how long GitHub keeps webhook deliveries and a Gmail history ID stays valid            |
| [jev-terms](jev-terms/)                                     | what Jev's data terms allow, and whether its API takes a choice set per call           |
| [parquet-escape-hatch](parquet-escape-hatch/)               | whether the host rebuilds a consumer file from the lake with s2-lite stopped           |
