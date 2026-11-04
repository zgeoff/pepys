use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};
use std::time::Duration;

use pepys_schema::GithubPullRequestRow;
use tokio::signal::unix::{SignalKind, signal};

use crate::batch::{FactRunner, apply_batch};
use crate::consumer::{ConsumerSpec, find_consumer};
use crate::database::{Store, checkpoint, open_store, prepare_store, read_offset};
use crate::diff::{TableDiff, diff_json, diff_rows};
use crate::error::HostError;
use crate::lock::WriterLock;
use crate::module_runner::ModuleRunner;
use crate::pull_request_rows::{TABLE, load_all_rows};
use crate::stream::{FactLog, S2Settings, StreamReader};
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
    runner: Box<dyn FactRunner>,
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

    Ok(Version {
        store,
        runner: Box::new(runner),
    })
}

/// Applies every record after the stored offset, one read at a time, until the log's tail. The
/// tail is read again after each pass, so records that arrive meanwhile are applied too.
async fn catch_up(
    version: &mut Version,
    spec: &ConsumerSpec,
    reader: &impl FactLog,
) -> Result<(), HostError> {
    loop {
        let tail = reader.tail().await?;

        if replay_to(version, spec, reader, tail).await? == 0 {
            return Ok(());
        }
    }
}

/// Applies the records after the stored offset whose sequence numbers are below `stop`, one read
/// at a time, and returns how many it applied.
async fn replay_to(
    version: &mut Version,
    spec: &ConsumerSpec,
    reader: &impl FactLog,
    stop: u64,
) -> Result<u64, HostError> {
    let mut applied = 0_u64;

    loop {
        let next = read_offset(&version.store, spec.stream)
            .await?
            .map_or(0, |offset| offset + 1);

        if next >= stop {
            return Ok(applied);
        }

        let count = usize::try_from(stop - next).map_or(BATCH_SIZE, |left| left.min(BATCH_SIZE));
        let facts = reader.read(next, count).await?;

        if facts.is_empty() {
            return Ok(applied);
        }

        apply_batch(&version.store, spec, version.runner.as_mut(), &facts).await?;
        applied += facts.len() as u64;
    }
}

/// The version's rows and the sequence number after its last applied record, read in one
/// transaction so that a writer's commit between the two reads cannot set them apart.
async fn read_rows_and_stop(
    store: &Store,
    spec: &ConsumerSpec,
) -> Result<(Vec<GithubPullRequestRow>, u64), HostError> {
    store.connection.execute("BEGIN", ()).await?;

    let read = async {
        let stop = read_offset(store, spec.stream)
            .await?
            .map_or(0, |offset| offset + 1);

        Ok::<_, HostError>((load_all_rows(&store.connection).await?, stop))
    }
    .await;

    store.connection.execute("COMMIT", ()).await?;

    read
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

/// Makes the `current` link follow the version that `host.db` records as current, and returns that
/// version's hash. A swap that stopped between the two writes leaves them apart, and the record is
/// the truth. The caller holds the writer lock.
async fn reconcile_current(
    consumer_dir: &Path,
    state: &HostState,
    consumer: &str,
) -> Result<Option<String>, HostError> {
    let recorded = state.find_hash(consumer, VersionState::Current).await?;

    if let Some(hash) = &recorded {
        let linked = std::fs::read_link(consumer_dir.join(CURRENT_LINK)).ok();

        if linked.as_deref() != Some(Path::new(hash)) {
            repoint_current(consumer_dir, hash)?;
        }
    }

    Ok(recorded)
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
            let state = config.host_state().await?;

            reconcile_current(&consumer_dir, &state, consumer).await?;

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
    let bytes = std::fs::read(module)?;
    let hash = crate::module_runner::hash_module(&bytes);

    std::fs::create_dir_all(&consumer_dir)?;

    if let Some(report) = keep_current(config, spec, &reader, &hash).await? {
        return Ok(report);
    }

    // One build of a hash at a time, so a second `up` of the same module never clears the files
    // that the first is writing.
    let _build = WriterLock::acquire(&consumer_dir.join("builds").join(&hash), LOCK_WAIT).await?;

    // The other `up` may have swapped this module in while this one waited.
    if let Some(report) = keep_current(config, spec, &reader, &hash).await? {
        return Ok(report);
    }

    let directory = consumer_dir.join(&hash);
    let state = config.host_state().await?;

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
    // The state is read again under the lock: another `up` may have swapped a version in since.
    let state = config.host_state().await?;
    let current = reconcile_current(&consumer_dir, &state, consumer).await?;

    if current.as_deref() == Some(hash.as_str()) {
        return Ok(no_swap_report(consumer, &hash));
    }

    catch_up(&mut version, spec, &reader).await?;
    checkpoint(&version.store).await?;

    state
        .swap_current(consumer, current.as_deref(), &hash)
        .await?;
    repoint_current(&consumer_dir, &hash)?;

    Ok(format!("{consumer} {hash}: swapped\n"))
}

fn no_swap_report(consumer: &str, hash: &str) -> String {
    format!("{consumer} {hash}: no swap, the module is current\n")
}

/// When `hash` is the current version, catches it up under the writer lock and reports no swap.
async fn keep_current(
    config: &HostConfig,
    spec: &'static ConsumerSpec,
    reader: &StreamReader,
    hash: &str,
) -> Result<Option<String>, HostError> {
    let consumer_dir = config.consumer_dir(spec.name);
    let _lock = WriterLock::acquire(&consumer_dir, LOCK_WAIT).await?;
    let state = config.host_state().await?;
    let current = reconcile_current(&consumer_dir, &state, spec.name).await?;

    if current.as_deref() != Some(hash) {
        return Ok(None);
    }

    let directory = consumer_dir.join(hash);
    let mut version = open_version(&directory, spec, &directory.join(MODULE_FILE)).await?;

    catch_up(&mut version, spec, reader).await?;

    Ok(Some(no_swap_report(spec.name, hash)))
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
    let previewed = open_version(scratch, spec, module).await?;

    compare_with_current(spec, consumer_dir, previewed, reader).await
}

/// Replays `previewed` to the current version's offset and returns its row diff against the
/// current version. With no current version, it replays to the log's tail.
async fn compare_with_current(
    spec: &ConsumerSpec,
    consumer_dir: &Path,
    mut previewed: Version,
    reader: &impl FactLog,
) -> Result<serde_json::Value, HostError> {
    // The previewed version stops where the current one stands, so records that only the
    // previewed version has read never show as a change.
    let (before, stop) = match current_hash_dir(consumer_dir) {
        Ok(directory) => {
            let store = open_store(&directory.join(DATABASE_FILE)).await?;

            read_rows_and_stop(&store, spec).await?
        }
        Err(HostError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
            (Vec::new(), reader.tail().await?)
        }
        Err(error) => return Err(error),
    };

    replay_to(&mut previewed, spec, reader, stop).await?;

    let after = load_all_rows(&previewed.store.connection).await?;
    let diff: TableDiff = diff_rows(&before, &after);

    Ok(diff_json(&[(TABLE, diff)]))
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;
    use crate::test_utils::{CannedRunner, MemoryLog, upsert_json};

    async fn open_test_version(directory: &Path, runner: CannedRunner) -> Version {
        let spec = find_consumer("github_pull_request").expect("the consumer");

        std::fs::create_dir_all(directory).expect("a version directory");

        let store = open_store(&directory.join(DATABASE_FILE))
            .await
            .expect("a store");

        prepare_store(&store, spec.schema)
            .await
            .expect("the schema");

        Version {
            store,
            runner: Box::new(runner),
        }
    }

    #[tokio::test]
    async fn it_previews_the_current_module_as_no_change_when_the_current_version_is_behind_the_log()
     {
        let directory = tempfile::tempdir().expect("a directory");
        let spec = find_consumer("github_pull_request").expect("the consumer");
        let module = || {
            CannedRunner::new(&[
                ("a", Ok(upsert_json("github:pr:1", "First"))),
                ("b", Ok(upsert_json("github:pr:2", "Second"))),
                ("c", Ok(upsert_json("github:pr:3", "Third"))),
            ])
        };
        let mut current = open_test_version(&directory.path().join("abc123"), module()).await;

        catch_up(&mut current, spec, &MemoryLog::new(&["a", "b"]))
            .await
            .expect("the current version at offset 1");
        repoint_current(directory.path(), "abc123").expect("a current link");

        let previewed = open_test_version(&directory.path().join("preview"), module()).await;

        let diff = compare_with_current(
            spec,
            directory.path(),
            previewed,
            &MemoryLog::new(&["a", "b", "c"]),
        )
        .await
        .expect("a diff");

        assert_eq!(diff, serde_json::json!({}));
    }

    async fn state_with_current(directory: &Path, hash: &str) -> HostState {
        let state = HostState::open(&directory.join("host.db"))
            .await
            .expect("a host state");

        state
            .register("github_pull_request", hash)
            .await
            .expect("a registered version");
        state
            .move_to("github_pull_request", hash, VersionState::Current)
            .await
            .expect("a current version");

        state
    }

    #[tokio::test]
    async fn it_previews_every_row_as_added_when_no_version_is_current() {
        let directory = tempfile::tempdir().expect("a directory");
        let spec = find_consumer("github_pull_request").expect("the consumer");
        let previewed = open_test_version(
            &directory.path().join("preview"),
            CannedRunner::new(&[
                ("a", Ok(upsert_json("github:pr:1", "First"))),
                ("b", Ok(upsert_json("github:pr:2", "Second"))),
            ]),
        )
        .await;

        let diff = compare_with_current(
            spec,
            directory.path(),
            previewed,
            &MemoryLog::new(&["a", "b"]),
        )
        .await
        .expect("a diff");

        assert_eq!(
            diff,
            serde_json::json!({
                "github_pull_request": {
                    "added": ["github:pr:1", "github:pr:2"],
                    "changed": [],
                    "removed": [],
                },
            })
        );
    }

    #[tokio::test]
    async fn it_creates_the_current_link_that_an_interrupted_swap_never_made() {
        let directory = tempfile::tempdir().expect("a directory");
        let state = state_with_current(directory.path(), "abc123").await;

        let recorded = reconcile_current(directory.path(), &state, "github_pull_request")
            .await
            .expect("a reconciled link");

        assert_eq!(recorded.as_deref(), Some("abc123"));
        assert_eq!(
            std::fs::read_link(directory.path().join(CURRENT_LINK)).expect("a link"),
            Path::new("abc123")
        );
    }

    #[tokio::test]
    async fn it_repoints_a_current_link_that_follows_an_older_version() {
        let directory = tempfile::tempdir().expect("a directory");
        let state = state_with_current(directory.path(), "new456").await;

        symlink("old123", directory.path().join(CURRENT_LINK)).expect("a stale link");

        reconcile_current(directory.path(), &state, "github_pull_request")
            .await
            .expect("a reconciled link");

        assert_eq!(
            std::fs::read_link(directory.path().join(CURRENT_LINK)).expect("a link"),
            Path::new("new456")
        );
    }

    #[tokio::test]
    async fn it_leaves_the_link_alone_when_no_version_is_current() {
        let directory = tempfile::tempdir().expect("a directory");
        let state = HostState::open(&directory.path().join("host.db"))
            .await
            .expect("a host state");

        let recorded = reconcile_current(directory.path(), &state, "github_pull_request")
            .await
            .expect("no change");

        assert_eq!(recorded, None);
        assert!(std::fs::read_link(directory.path().join(CURRENT_LINK)).is_err());
    }
}
