# Parquet escape hatch

The lake keeps a Parquet copy of every fact so that pepys survives the loss of s2-lite. That copy
only counts if a projection can be rebuilt from it alone.

## Question

Can the host rebuild one consumer's file from the lake with s2-lite stopped, and does the result
equal the file built from the log?

## Method

1. Build one consumer's file from the log.
2. Run the compaction job to write that consumer's stream to Parquet.
3. Stop s2-lite and rebuild the same consumer from the Parquet files.
4. Compare the two files row by row.

## Passes when

The two files hold the same rows.

## Run

The spike has no runner yet.

## Result

The spike has not run.

## Untested

Every step of the method, until the spike runs.
