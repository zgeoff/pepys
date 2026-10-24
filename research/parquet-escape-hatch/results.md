# Parquet escape hatch: results

The spike has not run. This file holds its method and the check it must pass, and the
[README](README.md) holds the question.

## Method

1. Build one consumer's file from the log.
2. Run the compaction job to write that consumer's stream to Parquet.
3. Stop s2-lite and rebuild the same consumer from the Parquet files.
4. Compare the two files row by row.

The spike passes when the two files hold the same rows.

## Setup

The spike has no runner yet, and its `package.json` pins no version.

## Untested

Every step of the method, until the spike runs.
