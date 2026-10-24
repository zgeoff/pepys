use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::signal::unix::{SignalKind, signal};

use crate::batch::{FactRunner, apply_batch};
use crate::consumer::{ConsumerSpec, find_consumer};
use crate::database::{Store, checkpoint, open_store, prepare_store, read_offset};
use crate::diff::{TableDiff, diff_json, diff_rows};
use crate::error::HostError;
use crate::lock::WriterLock;
use crate::module_runner::ModuleRunner;
use crate::pull_request_rows::{TABLE, load_all_rows};
use crate::stream::{S2Settings, StreamReader};
use crate::versions::{HostState, VersionState};

const DATABASE_FILE: &str = "consumer.db";
const MODULE_FILE: &str = "module.wasm";
const CURRENT_LINK: &str = "current";
const BATCH_SIZE: usize = 100;
const POLL_INTERVAL: Duration = Duration::from_millis(200);
const LOCK_WAIT: Duration = Duration::from_secs(30);

/// Where the host keeps its files and how it reaches the log.
#[derive(Debug, Clone)]
pub struct HostConfig {
    pub s2: S2Settings,
    pub store_dir: PathBuf,
}

impl HostConfig {
    fn consumer_dir(&self, consumer: &str) -> PathBuf {
        self.store_dir.join(consumer)
    }

    async fn host_state(&self) -> Result<HostState, HostError> {
        std::fs::create_dir_all(&self.store_dir)?;

        HostState::open(&self.store_dir.join("host.db")).await
    }
}

/// A consumer file with the module that writes it.
struct Version {
    store: Store,
    runner: ModuleRunner,
}

async fn open_version(
    directory: &Path,
    spec: &'static ConsumerSpec,
    module: &Path,
) -> Result<Version, HostError> {
    std::fs::create_dir_all(directory)?;

    let store = open_store(&directory.join(DATABASE_FILE)).await?;

    prepare_store(&store, spec.schema).await?;

    let (runner, _hash) = ModuleRunner::from_file(module, spec)?;

    Ok(Version { store, runner })
}

/// Applies every record after the stored offset, one read at a time, until the log's tail.
async fn catch_up(
    version: &mut Version,
    spec: &ConsumerSpec,
    reader: &StreamReader,
) -> Result<u64, HostError> {
    let mut applied = 0_u64;

    loop {
        let next = read_offset(&version.store, spec.stream)
            .await?
            .map_or(0, |offset| offset + 1);

        if next >= reader.tail().await? {
            return Ok(applied);
        }

        let facts = reader.read(next, BATCH_SIZE).await?;

        if facts.is_empty() {
            return Ok(applied);
        }

        apply_batch(
            &version.store,
            spec,
            &mut version.runner as &mut dyn FactRunner,
            &facts,
        )
        .await?;
        applied += facts.len() as u64;
    }
}

fn current_hash_dir(consumer_dir: &Path) -> Result<PathBuf, HostError> {
    Ok(std::fs::canonicalize(consumer_dir.join(CURRENT_LINK))?)
}

fn hash_of(directory: &Path) -> String {
    directory
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Repoints `current` at `hash` by making a temporary link and renaming it over the old one.
fn repoint_current(consumer_dir: &Path, hash: &str) -> Result<(), HostError> {
    let temporary = consumer_dir.join("current.tmp");

    match std::fs::remove_file(&temporary) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }

    symlink(hash, &temporary)?;
    std::fs::rename(&temporary, consumer_dir.join(CURRENT_LINK))?;

    Ok(())
}

async fn wait_for_stop() -> Result<(), HostError> {
    let mut terminate = signal(SignalKind::terminate())?;
    let mut interrupt = signal(SignalKind::interrupt())?;

    tokio::select! {
        _ = terminate.recv() => {}
        _ = interrupt.recv() => {}
    }

    Ok(())
}

/// Tails the stream and applies batches to the current version until SIGINT or SIGTERM.
///
/// # Errors
/// Fails when there is no current version or a batch fails.
pub async fn run(config: &HostConfig, consumer: &str) -> Result<(), HostError> {
    let spec = find_consumer(consumer)?;
    let consumer_dir = config.consumer_dir(consumer);
    let reader = StreamReader::connect(&config.s2, spec.stream)?;
    let stop = wait_for_stop();
    let mut opened: Option<(String, Version)> = None;

    tokio::pin!(stop);

    loop {
        {
            let _lock = WriterLock::acquire(&consumer_dir, LOCK_WAIT).await?;
            let directory = current_hash_dir(&consumer_dir)?;
            let hash = hash_of(&directory);

            if opened
                .as_ref()
                .is_none_or(|(open_hash, _)| *open_hash != hash)
            {
                opened = Some((
                    hash,
                    open_version(&directory, spec, &directory.join(MODULE_FILE)).await?,
                ));
            }

            if let Some((_, version)) = opened.as_mut() {
                catch_up(version, spec, &reader).await?;
            }
        }

        tokio::select! {
            result = &mut stop => return result,
            () = tokio::time::sleep(POLL_INTERVAL) => {}
        }
    }
}

/// Builds the module's version beside the current one and swaps it in, or reports no swap when
/// the module is already current.
///
/// # Errors
/// Fails when the module, the log or a file fails.
pub async fn up(config: &HostConfig, consumer: &str, module: &Path) -> Result<String, HostError> {
    let spec = find_consumer(consumer)?;
    let consumer_dir = config.consumer_dir(consumer);
    let reader = StreamReader::connect(&config.s2, spec.stream)?;
    let state = config.host_state().await?;
    let bytes = std::fs::read(module)?;
    let hash = crate::module_runner::hash_module(&bytes);
    let current = state.find_hash(consumer, VersionState::Current).await?;

    std::fs::create_dir_all(&consumer_dir)?;

    if current.as_deref() == Some(hash.as_str()) {
        let directory = consumer_dir.join(&hash);
        let _lock = WriterLock::acquire(&consumer_dir, LOCK_WAIT).await?;
        let mut version = open_version(&directory, spec, &directory.join(MODULE_FILE)).await?;

        catch_up(&mut version, spec, &reader).await?;

        return Ok(format!(
            "{consumer} {hash}: no swap, the module is current\n"
        ));
    }

    let directory = consumer_dir.join(&hash);

    match state.state(consumer, &hash).await? {
        Some(VersionState::Previous) => {}
        Some(VersionState::Removed) => {
            return Err(HostError::Config(format!("version {hash} was removed")));
        }
        Some(VersionState::Building | VersionState::Previewed | VersionState::Current) | None => {
            // A build that never finished starts again from the first record.
            if directory.exists() {
                std::fs::remove_dir_all(&directory)?;
            }

            state.register(consumer, &hash).await?;
        }
    }

    std::fs::create_dir_all(&directory)?;
    std::fs::write(directory.join(MODULE_FILE), &bytes)?;

    let mut version = open_version(&directory, spec, &directory.join(MODULE_FILE)).await?;

    // Replay while the live version keeps writing, then pause its writer for the last stretch.
    catch_up(&mut version, spec, &reader).await?;

    let _lock = WriterLock::acquire(&consumer_dir, LOCK_WAIT).await?;

    catch_up(&mut version, spec, &reader).await?;
    checkpoint(&version.store).await?;

    if let Some(previous) = &current {
        state
            .move_to(consumer, previous, VersionState::Previous)
            .await?;
    }

    state
        .move_to(consumer, &hash, VersionState::Current)
        .await?;
    repoint_current(&consumer_dir, &hash)?;

    Ok(format!("{consumer} {hash}: swapped\n"))
}

/// Replays the module into a throwaway file and returns the row diff against the current version.
///
/// # Errors
/// Fails when the module, the log or a file fails.
pub async fn preview(
    config: &HostConfig,
    consumer: &str,
    module: &Path,
) -> Result<serde_json::Value, HostError> {
    let spec = find_consumer(consumer)?;
    let consumer_dir = config.consumer_dir(consumer);
    let reader = StreamReader::connect(&config.s2, spec.stream)?;
    let scratch = consumer_dir.join(format!("preview-{}", std::process::id()));

    std::fs::create_dir_all(&consumer_dir)?;

    let result = replay_and_compare(spec, &consumer_dir, &scratch, module, &reader).await;

    std::fs::remove_dir_all(&scratch)?;

    result
}

async fn replay_and_compare(
    spec: &'static ConsumerSpec,
    consumer_dir: &Path,
    scratch: &Path,
    module: &Path,
    reader: &StreamReader,
) -> Result<serde_json::Value, HostError> {
    let mut previewed = open_version(scratch, spec, module).await?;

    catch_up(&mut previewed, spec, reader).await?;

    let after = load_all_rows(&previewed.store.connection).await?;
    let before = match current_hash_dir(consumer_dir) {
        Ok(directory) => {
            let store = open_store(&directory.join(DATABASE_FILE)).await?;

            load_all_rows(&store.connection).await?
        }
        Err(HostError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(error) => return Err(error),
    };
    let diff: TableDiff = diff_rows(&before, &after);

    Ok(diff_json(&[(TABLE, diff)]))
}
