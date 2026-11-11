# Reference code: scope mode in the host

This branch holds trial code that ran a compiled scope consumer through the host: the scope batch,
the scope replace, rows from a manifest, the fact index and the link check. Read it, and do not
merge it. `docs/design/v1-open.md` on `main` lists what the run found.

The 9 tests in `crates/host/src/spike.rs` read a hand-written manifest from `spike/home`, and the
module, the fact files and the expected results from `spike/real`. Run them from the repo root:

```bash
SPIKE_REAL=$PWD/spike/real SPIKE_HOME=$PWD/spike/home \
  cargo test -p pepys-host --lib spike -- --nocapture --test-threads=1
```

Set `SPIKE_MODULE=v3` to run the module that breaks a tie of time by fact ID.
