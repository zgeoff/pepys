# Spike: scriptc to WebAssembly

Consumers are TypeScript compiled by scriptc to WebAssembly and run by the host in wasmtime with no
network, clock or random imports. This spike proves that path on a real consumer before the first
consumer package depends on it.

## Question

Can scriptc compile a pure consumer that uses regular expressions and JSON to a WASI module that
wasmtime runs with every import denied, and does the module return the same operations as the same
function run under Bun?

## Method

1. Write the review-link derivation as a pure function over inline findings, commits and reviews.
2. Run `scriptc coverage` on it and record what the subset rejects.
3. Build it with scriptc for the WASI target.
4. List the module's imports, and run it under wasmtime with the clock and random imports denied.
5. Run the same function under Bun on the same input and compare the operation lists.

## Passes when

The module runs under wasmtime with no clock, random or network import, and its operation list
equals the Bun run's list for every input.
