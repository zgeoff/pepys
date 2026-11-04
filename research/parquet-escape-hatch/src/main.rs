//! Rebuilds one consumer's file from the lake's Parquet copy of its stream, with no log.
//!
//! Usage: `pepys-parquet-escape-hatch <consumer> <lake directory> <module> <output file>`. The run
//! prints one JSON line with the file count, the fact count and the time the rebuild took.

use std::fs::File;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Instant;

use parquet::file::reader::{FileReader, SerializedFileReader};
use parquet::record::RowAccessor;
use pepys_host::batch::{Fact, apply_batch};
use pepys_host::consumer::find_consumer;
use pepys_host::database::{checkpoint, open_store, prepare_store};
use pepys_host::error::HostError;
use pepys_host::module_runner::ModuleRunner;

// The host's replay reads 100 records at a time, so the rebuild applies batches of the same size.
const BATCH_SIZE: usize = 100;

#[derive(Debug, thiserror::Error)]
enum RebuildError {
    #[error("usage: pepys-parquet-escape-hatch <consumer> <lake directory> <module> <output file>")]
    Usage,
    #[error(transparent)]
    Host(#[from] HostError),
    #[error(transparent)]
    Parquet(#[from] parquet::errors::ParquetError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("the lake has no record {expected}, and the next record it holds is {found}")]
    Gap { expected: u64, found: u64 },
    #[error("the lake holds record {0} more than once")]
    Overlap(u64),
    #[error("the lake holds {held} records, below the {recorded} its offset records")]
    Short { held: u64, recorded: u64 },
    #[error("the lake's offset.json has no nextSeqNum")]
    NoOffset,
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("a sequence number is negative: {0}")]
    Negative(i64),
}

struct Rebuild {
    files: usize,
    facts: usize,
    elapsed_ms: u128,
}

#[tokio::main]
async fn main() -> ExitCode {
    match run_rebuild(std::env::args().skip(1).collect()).await {
        Ok(rebuild) => {
            println!(
                "{{\"files\":{},\"facts\":{},\"elapsedMs\":{}}}",
                rebuild.files, rebuild.facts, rebuild.elapsed_ms
            );

            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("rebuild: {error}");

            ExitCode::FAILURE
        }
    }
}

async fn run_rebuild(args: Vec<String>) -> Result<Rebuild, RebuildError> {
    let [consumer, lake, module, output] = args.as_slice() else {
        return Err(RebuildError::Usage);
    };

    let started = Instant::now();
    let spec = find_consumer(consumer)?;
    let stream_directory = Path::new(lake).join(spec.stream);
    let paths = collect_parquet_files(&stream_directory)?;
    let facts = read_facts(&paths)?;

    check_contiguous(&facts, read_next_seq_num(&stream_directory)?)?;

    let store = open_store(Path::new(output)).await?;

    prepare_store(&store, spec.schema).await?;

    let (mut runner, _hash) = ModuleRunner::from_file(Path::new(module), spec)?;

    for batch in facts.chunks(BATCH_SIZE) {
        apply_batch(&store, spec, &mut runner, batch).await?;
    }

    checkpoint(&store).await?;

    Ok(Rebuild {
        files: paths.len(),
        facts: facts.len(),
        elapsed_ms: started.elapsed().as_millis(),
    })
}

fn collect_parquet_files(directory: &Path) -> Result<Vec<PathBuf>, std::io::Error> {
    let mut paths = Vec::new();

    for entry in std::fs::read_dir(directory)? {
        let path = entry?.path();

        if path.is_dir() {
            paths.extend(collect_parquet_files(&path)?);
        } else if path
            .extension()
            .is_some_and(|extension| extension == "parquet")
        {
            paths.push(path);
        }
    }

    Ok(paths)
}

/// Every record in the files, sorted by sequence number. The columns are `seq_num`, `timestamp`
/// and `body`, in that order.
fn read_facts(paths: &[PathBuf]) -> Result<Vec<Fact>, RebuildError> {
    let mut facts = Vec::new();

    for path in paths {
        let reader = SerializedFileReader::new(File::open(path)?)?;

        for row in reader.get_row_iter(None)? {
            let row = row?;
            let seq_num = row.get_long(0)?;

            facts.push(Fact {
                seq_num: u64::try_from(seq_num).map_err(|_| RebuildError::Negative(seq_num))?,
                body: row.get_string(2)?.clone(),
            });
        }
    }

    facts.sort_by_key(|fact| fact.seq_num);

    Ok(facts)
}

/// The sequence number the compaction job recorded it reached, from the stream's `offset.json`.
fn read_next_seq_num(stream_directory: &Path) -> Result<u64, RebuildError> {
    let offset: serde_json::Value =
        serde_json::from_slice(&std::fs::read(stream_directory.join("offset.json"))?)?;

    offset
        .get("nextSeqNum")
        .and_then(serde_json::Value::as_u64)
        .ok_or(RebuildError::NoOffset)
}

/// The lake must hold every record from 0 up to the recorded offset once, or the rebuild would
/// apply a different log.
fn check_contiguous(facts: &[Fact], next_seq_num: u64) -> Result<(), RebuildError> {
    for (expected, fact) in (0_u64..).zip(facts) {
        if fact.seq_num < expected {
            return Err(RebuildError::Overlap(fact.seq_num));
        }

        if fact.seq_num > expected {
            return Err(RebuildError::Gap {
                expected,
                found: fact.seq_num,
            });
        }
    }

    let held = facts.len() as u64;

    if held < next_seq_num {
        return Err(RebuildError::Short {
            held,
            recorded: next_seq_num,
        });
    }

    Ok(())
}
