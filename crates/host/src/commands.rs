use std::collections::BTreeMap;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use tokio::signal::unix::{SignalKind, signal};
use tokio::task::JoinSet;

use crate::batch::{FactRunner, apply_batch};
use crate::consumer::{
    BuildManifest, ConsumerInput, ConsumerManifest, ConsumerVersion, ListedConsumer, find_consumer,
    has_version_file, read_build_manifest, read_version, write_version,
};
use crate::database::{
    Store, checkpoint, open_store, prepare_scope_tables, prepare_store, read_offset,
};
use crate::diff::{diff_json, diff_rows};
use crate::error::HostError;
use crate::fact_log::FactLog;
use crate::fact_log::s2::{S2Log, S2Settings};
use crate::lock::WriterLock;
use crate::module_runner::{ModuleRunner, hash_module};
use crate::rows::{Row, load_all_rows};
use crate::schema_check::check_schema;
use crate::scope::{ScopeRunner, apply_scope_batch};
use crate::versions::{HostState, VersionState};

const DATABASE_FILE: &str = "consumer.db";
const MODULE_FILE: &str = "module.wasm";
const CURRENT_LINK: &str = "current";
const BATCH_SIZE: usize = 100;
const POLL_INTERVAL: Duration = Duration::from_millis(200);
const LOCK_WAIT: Duration = Duration::from_secs(30);

/// Where the host keeps its files, where it reads `consumers.json`, and how it reaches the log.
#[derive(Debug, Clone)]
pub struct HostConfig {
    pub s2: S2Settings,
    pub store_dir: PathBuf,
    pub consumers: PathBuf,
}

impl HostConfig {
    fn consumer_dir(&self, consumer: &str) -> PathBuf {
        self.store_dir.join(consumer)
    }

    async fn host_state(&self) -> Result<HostState, HostError> {
        std::fs::create_dir_all(&self.store_dir)?;

        HostState::open(&self.store_dir.join("host.db")).await
    }

    fn read_build_manifest(&self) -> Result<BuildManifest, HostError> {
        read_build_manifest(&self.consumers)
    }

    fn module_path(&self, listed: &ListedConsumer) -> PathBuf {
        self.consumers
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(&listed.path)
    }
}

/// A consumer file with the module that writes it and the manifest it was built from.
struct Version {
    store: Store,
    runner: Runner,
    manifest: Arc<ConsumerManifest>,
}

/// The module of a version, in the mode its manifest gives.
enum Runner {
    Fact(Box<dyn FactRunner>),
    Scope {
        runner: Box<dyn ScopeRunner>,
        scope_kind: String,
    },
}

/// Opens the file of a version folder and checks it against the manifest. On a new file it runs
/// the manifest's SQL and makes the host's tables first.
async fn open_version_store(
    directory: &Path,
    manifest: &ConsumerManifest,
) -> Result<Store, HostError> {
    std::fs::create_dir_all(directory)?;

    let store = open_store(&directory.join(DATABASE_FILE)).await?;

    prepare_store(&store, &manifest.schema).await?;

    if matches!(manifest.input, ConsumerInput::Scope { .. }) {
        prepare_scope_tables(&store).await?;
    }

    check_schema(&store, manifest).await?;

    Ok(store)
}

/// The one way a version is opened: `up`, `run` and `preview` all call it. The module file must
/// have the hash the version lists.
async fn open_version(directory: &Path, version: &ConsumerVersion) -> Result<Version, HostError> {
    let manifest = Arc::new(version.manifest.clone());
    let store = open_version_store(directory, &manifest).await?;
    let bytes = std::fs::read(directory.join(MODULE_FILE))?;
    let found = hash_module(&bytes);

    if found != version.module {
        return Err(HostError::ModuleHash {
            consumer: version.name.clone(),
            listed: version.module.clone(),
            found,
        });
    }

    let module = ModuleRunner::new(&bytes, Arc::clone(&manifest))?;
    let runner = match &manifest.input {
        ConsumerInput::Fact { .. } => Runner::Fact(Box::new(module)),
        ConsumerInput::Scope { scope_kind, .. } => Runner::Scope {
            runner: Box::new(module),
            scope_kind: scope_kind.clone(),
        },
    };

    Ok(Version {
        store,
        runner,
        manifest,
    })
}

/// Applies every record after the stored offsets of each of the consumer's streams, one read at a
/// time, until one pass over every stream applies nothing.
async fn catch_up(version: &mut Version, log: &impl FactLog) -> Result<(), HostError> {
    loop {
        let mut applied = 0;

        for stream in version.manifest.input.streams().to_vec() {
            let tail = log.read_tail(&stream).await?;

            applied += replay_to(version, log, &stream, tail).await?;
        }

        if applied == 0 {
            return Ok(());
        }
    }
}

/// Applies the records of `stream` after the stored offset whose sequence numbers are below
/// `stop`, one read at a time, and returns how many it applied.
async fn replay_to(
    version: &mut Version,
    log: &impl FactLog,
    stream: &str,
    stop: u64,
) -> Result<u64, HostError> {
    let mut applied = 0_u64;

    loop {
        let next = read_offset(&version.store, stream)
            .await?
            .map_or(0, |offset| offset + 1);

        if next >= stop {
            return Ok(applied);
        }

        let count = usize::try_from(stop - next).map_or(BATCH_SIZE, |left| left.min(BATCH_SIZE));
        let facts = log.read(stream, next, count).await?;

        if facts.is_empty() {
            return Ok(applied);
        }

        match &mut version.runner {
            Runner::Fact(runner) => {
                apply_batch(
                    &version.store,
                    &version.manifest,
                    runner.as_mut(),
                    stream,
                    &facts,
                )
                .await?;
            }
            Runner::Scope { runner, scope_kind } => {
                apply_scope_batch(
                    &version.store,
                    &version.manifest,
                    scope_kind,
                    runner.as_mut(),
                    stream,
                    &facts,
                )
                .await?;
            }
        }
        applied += facts.len() as u64;
    }
}

type TableRows = BTreeMap<String, Vec<Row>>;

/// The version's rows of every table and, for each stream, the sequence number after its last
/// applied record, read in one transaction so that a writer's commit cannot set them apart.
async fn read_rows_and_stops(
    store: &Store,
    manifest: &ConsumerManifest,
) -> Result<(TableRows, BTreeMap<String, u64>), HostError> {
    store.connection.execute("BEGIN", ()).await?;

    let read = async {
        let mut stops = BTreeMap::new();

        for stream in manifest.input.streams() {
            let stop = read_offset(store, stream)
                .await?
                .map_or(0, |offset| offset + 1);

            stops.insert(stream.clone(), stop);
        }

        Ok::<_, HostError>((read_all_tables(store, manifest).await?, stops))
    }
    .await;

    store.connection.execute("COMMIT", ()).await?;

    read
}

async fn read_all_tables(
    store: &Store,
    manifest: &ConsumerManifest,
) -> Result<TableRows, HostError> {
    let mut tables = TableRows::new();

    for (table, info) in &manifest.tables {
        tables.insert(
            table.clone(),
            load_all_rows(&store.connection, table, info).await?,
        );
    }

    Ok(tables)
}

fn current_version_dir(consumer_dir: &Path) -> Result<PathBuf, HostError> {
    Ok(std::fs::canonicalize(consumer_dir.join(CURRENT_LINK))?)
}

fn name_of(directory: &Path) -> String {
    directory
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Repoints `current` at `version` by making a temporary link and renaming it over the old one.
fn repoint_current(consumer_dir: &Path, version: &str) -> Result<(), HostError> {
    let temporary = consumer_dir.join("current.tmp");

    match std::fs::remove_file(&temporary) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }

    symlink(version, &temporary)?;
    std::fs::rename(&temporary, consumer_dir.join(CURRENT_LINK))?;

    Ok(())
}

/// Makes the `current` link follow the version that `host.db` records as current, and returns that
/// version. A swap that stopped between the two writes leaves them apart, and the record is the
/// truth. The caller holds the writer lock.
async fn reconcile_current(
    consumer_dir: &Path,
    state: &HostState,
    consumer: &str,
) -> Result<Option<String>, HostError> {
    let recorded = state.find_hash(consumer, VersionState::Current).await?;

    if let Some(version) = &recorded {
        let linked = std::fs::read_link(consumer_dir.join(CURRENT_LINK)).ok();

        if linked.as_deref() != Some(Path::new(version)) {
            repoint_current(consumer_dir, version)?;
        }
    }

    Ok(recorded)
}

/// The current version of a consumer, read from its `version.json`.
fn read_current_version(
    config: &HostConfig,
    consumer: &str,
) -> Result<Option<ConsumerVersion>, HostError> {
    match current_version_dir(&config.consumer_dir(consumer)) {
        Ok(directory) => Ok(Some(read_version(&directory)?)),
        Err(HostError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

/// Refuses a version that declares a table which another consumer's current version owns.
fn check_table_owners(config: &HostConfig, version: &ConsumerVersion) -> Result<(), HostError> {
    let Ok(entries) = std::fs::read_dir(&config.store_dir) else {
        return Ok(());
    };

    for entry in entries {
        let owner = entry?.file_name().to_string_lossy().into_owned();

        if owner == version.name || !config.consumer_dir(&owner).join(CURRENT_LINK).exists() {
            continue;
        }

        let Some(current) = read_current_version(config, &owner)? else {
            continue;
        };

        if let Some(table) = version
            .manifest
            .tables
            .keys()
            .find(|table| current.manifest.tables.contains_key(*table))
        {
            return Err(HostError::TableOwned {
                consumer: version.name.clone(),
                table: table.clone(),
                owner,
            });
        }
    }

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

/// Runs every consumer that `consumers.json` lists, one task each, until SIGINT or SIGTERM. With
/// `up_first`, deploys every listed consumer before any task starts.
///
/// # Errors
/// Fails before any task starts when the file is refused, an `up` fails, a listed consumer has no
/// current version, or two current versions own one table. Fails after every task has stopped
/// with an error.
pub async fn run(config: &HostConfig, up_first: bool) -> Result<(), HostError> {
    let log = S2Log::connect(&config.s2)?;
    let file = start_run(config, &log, up_first).await?;
    let stop = wait_for_stop();
    let mut tasks = JoinSet::new();

    tokio::pin!(stop);

    for listed in &file.consumers {
        tasks.spawn(run_consumer(config.clone(), listed.name.clone()));
    }

    if tasks.is_empty() {
        return stop.await;
    }

    loop {
        tokio::select! {
            result = &mut stop => {
                tasks.abort_all();

                return result;
            }
            joined = tasks.join_next() => match joined {
                Some(Ok(Err(error))) => eprintln!("pepys: {error}"),
                Some(Ok(Ok(()))) => {}
                Some(Err(error)) => eprintln!("pepys: a consumer task ended: {error}"),
                None => {
                    return Err(HostError::Config("every consumer task stopped".to_owned()));
                }
            },
        }
    }
}

/// The checks before `run` starts a task, after the `up` of `--up`.
async fn start_run(
    config: &HostConfig,
    log: &impl FactLog,
    up_first: bool,
) -> Result<BuildManifest, HostError> {
    let file = config.read_build_manifest()?;

    if up_first {
        print!("{}", up_listed(config, log, &file, None).await?);
    }

    let mut owners: BTreeMap<String, String> = BTreeMap::new();

    for listed in &file.consumers {
        let current = read_current_version(config, &listed.name)?
            .ok_or_else(|| HostError::NoCurrentVersion(listed.name.clone()))?;

        for table in current.manifest.tables.keys() {
            if let Some(owner) = owners.insert(table.clone(), listed.name.clone()) {
                return Err(HostError::TableOwned {
                    consumer: listed.name.clone(),
                    table: table.clone(),
                    owner,
                });
            }
        }
    }

    Ok(file)
}

/// One consumer's task: on each pass, take the writer lock, open the current version when it
/// changed, and catch up. A failed batch stops this task alone.
async fn run_consumer(config: HostConfig, consumer: String) -> Result<(), HostError> {
    let wrap = |error| HostError::Stopped {
        consumer: consumer.clone(),
        source: Box::new(error),
    };
    let log = S2Log::connect(&config.s2).map_err(wrap)?;
    let consumer_dir = config.consumer_dir(&consumer);
    let mut opened: Option<(String, Version)> = None;

    loop {
        run_pass(&config, &log, &consumer, &consumer_dir, &mut opened)
            .await
            .map_err(wrap)?;
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

async fn run_pass(
    config: &HostConfig,
    log: &impl FactLog,
    consumer: &str,
    consumer_dir: &Path,
    opened: &mut Option<(String, Version)>,
) -> Result<(), HostError> {
    let _lock = WriterLock::acquire(consumer_dir, LOCK_WAIT).await?;
    let state = config.host_state().await?;

    reconcile_current(consumer_dir, &state, consumer).await?;

    let directory = current_version_dir(consumer_dir)?;
    let name = name_of(&directory);

    if opened.as_ref().is_none_or(|(open, _)| *open != name) {
        let version = read_version(&directory)?;

        *opened = Some((name, open_version(&directory, &version).await?));
    }

    if let Some((_, version)) = opened.as_mut() {
        catch_up(version, log).await?;
    }

    Ok(())
}

/// Deploys the listed version of `consumer`, or with no name every listed consumer in file order,
/// stopping at the first failure. With `kept`, deploys that kept version of `consumer` instead.
///
/// # Errors
/// Fails when the file is refused or an `up` fails, with the consumer's name.
pub async fn up(
    config: &HostConfig,
    consumer: Option<&str>,
    kept: Option<&str>,
) -> Result<String, HostError> {
    let log = S2Log::connect(&config.s2)?;
    let file = config.read_build_manifest()?;

    match (consumer, kept) {
        (Some(consumer), Some(kept)) => up_kept(config, &log, consumer, kept).await,
        (None, Some(_)) => Err(HostError::Config(
            "--version needs the name of a consumer".to_owned(),
        )),
        (consumer, None) => up_listed(config, &log, &file, consumer).await,
    }
}

async fn up_listed(
    config: &HostConfig,
    log: &impl FactLog,
    file: &BuildManifest,
    consumer: Option<&str>,
) -> Result<String, HostError> {
    let targets: Vec<&ListedConsumer> = match consumer {
        Some(name) => vec![find_consumer(file, name)?],
        None => file.consumers.iter().collect(),
    };
    let mut report = String::new();

    for listed in targets {
        let wrap = |error| HostError::Up {
            consumer: listed.name.clone(),
            source: Box::new(error),
        };
        let bytes =
            std::fs::read(config.module_path(listed)).map_err(|error| wrap(error.into()))?;
        let found = hash_module(&bytes);

        if found != listed.module {
            return Err(wrap(HostError::ModuleHash {
                consumer: listed.name.clone(),
                listed: listed.module.clone(),
                found,
            }));
        }

        report.push_str(
            &up_version(config, log, &listed.to_version(), &bytes)
                .await
                .map_err(wrap)?,
        );
    }

    Ok(report)
}

async fn up_kept(
    config: &HostConfig,
    log: &impl FactLog,
    consumer: &str,
    kept: &str,
) -> Result<String, HostError> {
    let wrap = |error| HostError::Up {
        consumer: consumer.to_owned(),
        source: Box::new(error),
    };
    let state = config.host_state().await.map_err(wrap)?;

    if state.state(consumer, kept).await.map_err(wrap)? != Some(VersionState::Previous) {
        return Err(wrap(HostError::Config(format!(
            "version {kept} is not a previous version of {consumer}"
        ))));
    }

    let directory = config.consumer_dir(consumer).join(kept);
    let version = read_version(&directory).map_err(wrap)?;
    let bytes = std::fs::read(directory.join(MODULE_FILE)).map_err(|error| wrap(error.into()))?;

    up_version(config, log, &version, &bytes)
        .await
        .map_err(wrap)
}

/// Builds the version beside the current one and swaps it in, or reports no swap when it is
/// already current.
async fn up_version(
    config: &HostConfig,
    log: &impl FactLog,
    version: &ConsumerVersion,
    bytes: &[u8],
) -> Result<String, HostError> {
    let consumer = version.name.as_str();
    let name = version.version.as_str();
    let consumer_dir = config.consumer_dir(consumer);
    let directory = consumer_dir.join(name);

    std::fs::create_dir_all(&consumer_dir)?;

    // The host trusts the version as a name, so it refuses two manifests under one.
    if has_version_file(&directory) {
        match read_version(&directory) {
            Ok(found) if found != *version => {
                return Err(HostError::VersionClash {
                    consumer: consumer.to_owned(),
                    version: name.to_owned(),
                });
            }
            Ok(_) => {}
            // An unfinished build starts again below, whatever its version file holds.
            Err(_) if is_unfinished(config.host_state().await?.state(consumer, name).await?) => {}
            Err(error) => return Err(error),
        }
    }

    check_table_owners(config, version)?;

    if let Some(report) = keep_current(config, log, version).await? {
        return Ok(report);
    }

    // One build of a version at a time, so a second `up` of it never clears the files that the
    // first is writing.
    let _build = WriterLock::acquire(&consumer_dir.join("builds").join(name), LOCK_WAIT).await?;

    // The other `up` may have swapped this version in while this one waited.
    if let Some(report) = keep_current(config, log, version).await? {
        return Ok(report);
    }

    let state = config.host_state().await?;

    match state.state(consumer, name).await? {
        Some(VersionState::Previous) => {}
        Some(VersionState::Removed) => {
            return Err(HostError::Config(format!("version {name} was removed")));
        }
        Some(VersionState::Building | VersionState::Previewed | VersionState::Current) | None => {
            // A build that never finished starts again from the first record.
            if directory.exists() {
                std::fs::remove_dir_all(&directory)?;
            }

            state.register(consumer, name).await?;
        }
    }

    std::fs::create_dir_all(&directory)?;
    std::fs::write(directory.join(MODULE_FILE), bytes)?;
    write_version(&directory, version)?;

    let mut opened = open_version(&directory, version).await?;

    // Replay while the live version keeps writing, then pause its writer for the last stretch.
    catch_up(&mut opened, log).await?;

    let _lock = WriterLock::acquire(&consumer_dir, LOCK_WAIT).await?;
    // The state is read again under the lock: another `up` may have swapped a version in since.
    let state = config.host_state().await?;
    let current = reconcile_current(&consumer_dir, &state, consumer).await?;

    if current.as_deref() == Some(name) {
        return Ok(no_swap_report(consumer, name));
    }

    catch_up(&mut opened, log).await?;
    checkpoint(&opened.store).await?;

    state
        .swap_current(consumer, current.as_deref(), name)
        .await?;
    repoint_current(&consumer_dir, name)?;

    Ok(format!("{consumer} {name}: swapped\n"))
}

/// Whether a version in `state` is a build that never finished, which `up` builds again from the
/// first record.
fn is_unfinished(state: Option<VersionState>) -> bool {
    matches!(
        state,
        None | Some(VersionState::Building | VersionState::Previewed)
    )
}

fn no_swap_report(consumer: &str, version: &str) -> String {
    format!("{consumer} {version}: no swap, the version is current\n")
}

/// When `version` is the current version, catches it up under the writer lock and reports no swap.
async fn keep_current(
    config: &HostConfig,
    log: &impl FactLog,
    version: &ConsumerVersion,
) -> Result<Option<String>, HostError> {
    let consumer_dir = config.consumer_dir(&version.name);
    let _lock = WriterLock::acquire(&consumer_dir, LOCK_WAIT).await?;
    let state = config.host_state().await?;
    let current = reconcile_current(&consumer_dir, &state, &version.name).await?;

    if current.as_deref() != Some(version.version.as_str()) {
        return Ok(None);
    }

    let directory = consumer_dir.join(&version.version);
    let mut opened = open_version(&directory, version).await?;

    catch_up(&mut opened, log).await?;

    Ok(Some(no_swap_report(&version.name, &version.version)))
}

/// Replays the listed version of `consumer` into a throwaway folder and returns its row diff
/// against the current version.
///
/// # Errors
/// Fails when the file is refused, or the module, the log or a file fails.
pub async fn preview(config: &HostConfig, consumer: &str) -> Result<serde_json::Value, HostError> {
    let log = S2Log::connect(&config.s2)?;
    let file = config.read_build_manifest()?;
    let listed = find_consumer(&file, consumer)?;
    let consumer_dir = config.consumer_dir(consumer);
    let scratch = consumer_dir.join(format!("preview-{}", std::process::id()));
    let bytes = std::fs::read(config.module_path(listed))?;

    std::fs::create_dir_all(&scratch)?;

    let result = async {
        std::fs::write(scratch.join(MODULE_FILE), &bytes)?;

        let previewed = open_version(&scratch, &listed.to_version()).await?;

        compare_with_current(config, consumer, previewed, &log).await
    }
    .await;

    std::fs::remove_dir_all(&scratch)?;

    result
}

/// Replays `previewed` to the current version's offsets and returns its row diff against the
/// current version. With no current version, it replays to the log's tail.
async fn compare_with_current(
    config: &HostConfig,
    consumer: &str,
    mut previewed: Version,
    log: &impl FactLog,
) -> Result<serde_json::Value, HostError> {
    // The previewed version stops where the current one stands, so records that only the
    // previewed version has read never show as a change.
    let (before, stops) = if let Some(current) = read_current_version(config, consumer)? {
        let directory = current_version_dir(&config.consumer_dir(consumer))?;
        let store = open_store(&directory.join(DATABASE_FILE)).await?;

        read_rows_and_stops(&store, &current.manifest).await?
    } else {
        let mut stops = BTreeMap::new();

        for stream in previewed.manifest.input.streams() {
            stops.insert(stream.clone(), log.read_tail(stream).await?);
        }

        (TableRows::new(), stops)
    };

    for (stream, stop) in &stops {
        replay_to(&mut previewed, log, stream, *stop).await?;
    }

    let after = read_all_tables(&previewed.store, &previewed.manifest).await?;
    let mut diffs = Vec::new();

    for (table, info) in &previewed.manifest.tables {
        let empty = Vec::new();
        let current = before.get(table).unwrap_or(&empty);
        let rows = after.get(table).unwrap_or(&empty);

        diffs.push((table.clone(), diff_rows(table, info, current, rows)?));
    }

    Ok(diff_json(&diffs))
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::fact_log::memory::MemoryLog;
    use crate::test_utils::{
        CannedRunner, build_text_module, stub_build_manifest, stub_scope_manifest, upsert_json,
    };

    const STREAM: &str = "facts.github.pull_request";

    struct TestHost {
        _directory: tempfile::TempDir,
        config: HostConfig,
    }

    fn setup_test() -> TestHost {
        let directory = tempfile::tempdir().expect("a directory");
        let config = HostConfig {
            s2: S2Settings {
                endpoint: "http://127.0.0.1:1".to_owned(),
                access_token: "unused".to_owned(),
                basin: "unused".to_owned(),
            },
            store_dir: directory.path().join("store"),
            consumers: directory.path().join("build/consumers.json"),
        };

        TestHost {
            _directory: directory,
            config,
        }
    }

    /// The stub deployment's entry, with a module that returns `output` for every fact.
    fn build_listed(version: &str, output: &str) -> (ListedConsumer, Vec<u8>) {
        let mut listed = stub_build_manifest().consumers.remove(0);
        let bytes = build_text_module(
            &listed.manifest.exports.init,
            &listed.manifest.exports.apply,
            output,
        );

        listed.module = hash_module(&bytes);
        listed.version = version.to_owned();
        listed.path = format!("{}/{}.wasm", listed.name, listed.module);

        (listed, bytes)
    }

    /// Writes `consumers.json` and each module beside it, as `pepys build` does.
    fn write_build(config: &HostConfig, entries: &[(ListedConsumer, Vec<u8>)]) -> BuildManifest {
        let file = BuildManifest {
            kit: 1,
            deployment: Some("harbour".to_owned()),
            consumers: entries.iter().map(|(listed, _)| listed.clone()).collect(),
        };

        for (listed, bytes) in entries {
            let path = config.module_path(listed);

            std::fs::create_dir_all(path.parent().expect("a folder")).expect("a module folder");
            std::fs::write(path, bytes).expect("a module");
        }

        std::fs::write(
            &config.consumers,
            serde_json::to_string(&file).expect("the file's JSON"),
        )
        .expect("consumers.json");

        config
            .read_build_manifest()
            .expect("a file the host accepts")
    }

    fn version_hash(digit: char) -> String {
        std::iter::repeat_n(digit, 64).collect()
    }

    #[tokio::test]
    async fn it_swaps_in_the_listed_version_and_keeps_its_version_file() {
        let ctx = setup_test();
        let (listed, bytes) = build_listed(&version_hash('a'), "[]");
        let file = write_build(&ctx.config, &[(listed.clone(), bytes)]);

        let report = up_listed(&ctx.config, &MemoryLog::seeded(STREAM, &["a"]), &file, None)
            .await
            .expect("an up");

        assert_eq!(
            report,
            format!("github_pull_request {}: swapped\n", version_hash('a'))
        );
        assert_eq!(
            read_current_version(&ctx.config, "github_pull_request").expect("a read"),
            Some(listed.to_version())
        );
    }

    #[tokio::test]
    async fn it_writes_the_rows_of_a_module_linked_by_the_manifests_symbols() {
        let ctx = setup_test();
        let (listed, bytes) = build_listed(
            &version_hash('a'),
            &upsert_json("github:pull_request:7", "Tides"),
        );
        let file = write_build(&ctx.config, &[(listed, bytes)]);

        up_listed(&ctx.config, &MemoryLog::seeded(STREAM, &["a"]), &file, None)
            .await
            .expect("an up");

        let directory = current_version_dir(&ctx.config.consumer_dir("github_pull_request"))
            .expect("a current version");
        let store = open_store(&directory.join(DATABASE_FILE))
            .await
            .expect("the store");
        let manifest = &file.consumers[0].manifest;
        let rows = read_all_tables(&store, manifest).await.expect("the rows");

        assert_eq!(
            rows["github_pull_request"]
                .iter()
                .map(|row| row["title"].clone())
                .collect::<Vec<_>>(),
            vec![json!("Tides")]
        );
    }

    /// An entry of the stub scope consumer, with a module that returns `output` for every scope.
    fn build_scope_listed(output: &str) -> (ListedConsumer, Vec<u8>) {
        let manifest = stub_scope_manifest();
        let bytes = build_text_module(&manifest.exports.init, &manifest.exports.apply, output);
        let module = hash_module(&bytes);

        (
            ListedConsumer {
                name: manifest.name.clone(),
                path: format!("{}/{module}.wasm", manifest.name),
                module,
                pins: BTreeMap::new(),
                version: version_hash('c'),
                manifest,
            },
            bytes,
        )
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn it_ups_a_scope_consumer_and_writes_the_rows_its_module_returns() {
        let ctx = setup_test();
        let output = json!([{"upsert": {"ledger_account": {
            "id": "ledger:account:a", "name": "Alpha", "balance": 5, "is_closed": false,
            "opened_at": null, "updated_at": "2026-11-01T09:00:00Z"
        }}}])
        .to_string();
        let (listed, bytes) = build_scope_listed(&output);
        let file = write_build(&ctx.config, &[(listed, bytes)]);
        let log = MemoryLog::seeded(
            "facts.ledger.account",
            &[r#"{"id":"event:ledger:1","entity":"ledger:account:a","at":"2026-11-01T09:00:00Z"}"#],
        );

        up_listed(&ctx.config, &log, &file, None)
            .await
            .expect("an up");

        let directory = current_version_dir(&ctx.config.consumer_dir("ledger_account"))
            .expect("a current version");
        let store = open_store(&directory.join(DATABASE_FILE))
            .await
            .expect("the store");
        let rows = read_all_tables(&store, &file.consumers[0].manifest)
            .await
            .expect("the rows");

        assert_eq!(
            rows["ledger_account"]
                .iter()
                .map(|row| row["name"].clone())
                .collect::<Vec<_>>(),
            vec![json!("Alpha")]
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn it_previews_the_current_scope_module_as_no_change() {
        let ctx = setup_test();
        let output = json!([{"upsert": {"ledger_account": {
            "id": "ledger:account:a", "name": "Alpha", "balance": 5, "is_closed": false,
            "opened_at": null, "updated_at": "2026-11-01T09:00:00Z"
        }}}])
        .to_string();
        let (listed, bytes) = build_scope_listed(&output);
        let file = write_build(&ctx.config, &[(listed.clone(), bytes.clone())]);
        let log = MemoryLog::seeded(
            "facts.ledger.account",
            &[r#"{"id":"event:ledger:1","entity":"ledger:account:a","at":"2026-11-01T09:00:00Z"}"#],
        );

        up_listed(&ctx.config, &log, &file, None)
            .await
            .expect("an up");

        let scratch = ctx.config.consumer_dir("ledger_account").join("preview");

        std::fs::create_dir_all(&scratch).expect("a preview folder");
        std::fs::write(scratch.join(MODULE_FILE), &bytes).expect("a module");

        let previewed = open_version(&scratch, &listed.to_version())
            .await
            .expect("a previewed version");

        let diff = compare_with_current(&ctx.config, "ledger_account", previewed, &log)
            .await
            .expect("a diff");

        assert_eq!(diff, json!({}));
    }

    #[tokio::test]
    async fn it_reports_no_swap_for_the_version_that_is_current() {
        let ctx = setup_test();
        let (listed, bytes) = build_listed(&version_hash('a'), "[]");
        let file = write_build(&ctx.config, &[(listed, bytes)]);
        let log = MemoryLog::seeded(STREAM, &["a"]);

        up_listed(&ctx.config, &log, &file, None)
            .await
            .expect("the first up");

        let report = up_listed(&ctx.config, &log, &file, Some("github_pull_request"))
            .await
            .expect("the second up");

        assert_eq!(
            report,
            format!(
                "github_pull_request {}: no swap, the version is current\n",
                version_hash('a')
            )
        );
    }

    #[tokio::test]
    async fn it_ups_every_listed_consumer_in_file_order_when_no_name_is_given() {
        let ctx = setup_test();
        let (first, first_bytes) = build_listed(&version_hash('a'), "[]");
        let mut second: ListedConsumer = serde_json::from_str(
            &serde_json::to_string(&first)
                .expect("JSON")
                .replace("github_pull_request", "ledger_line")
                .replace("github_release_bump", "ledger_line_bump"),
        )
        .expect("a second consumer");
        let second_bytes = build_text_module(
            &second.manifest.exports.init,
            &second.manifest.exports.apply,
            "[]",
        );

        second.module = hash_module(&second_bytes);
        second.path = "ledger_line/module.wasm".to_owned();

        let file = write_build(&ctx.config, &[(first, first_bytes), (second, second_bytes)]);
        let log = MemoryLog::new(&[STREAM.to_owned(), "facts.ledger_line.x".to_owned()]);

        let report = up_listed(&ctx.config, &log, &file, None)
            .await
            .expect("an up");

        assert_eq!(
            report,
            format!(
                "github_pull_request {0}: swapped\nledger_line {0}: swapped\n",
                version_hash('a')
            )
        );
    }

    #[tokio::test]
    async fn it_refuses_a_second_manifest_under_one_version() {
        let ctx = setup_test();
        let (listed, bytes) = build_listed(&version_hash('a'), "[]");
        let file = write_build(&ctx.config, &[(listed.clone(), bytes.clone())]);
        let log = MemoryLog::seeded(STREAM, &["a"]);

        up_listed(&ctx.config, &log, &file, None)
            .await
            .expect("the first up");

        let mut changed = listed;

        changed.manifest.schema.push('\n');

        let file = write_build(&ctx.config, &[(changed, bytes)]);

        let result = up_listed(&ctx.config, &log, &file, None).await;

        assert_eq!(
            result.map_err(|error| error.to_string()),
            Err(format!(
                "up github_pull_request failed: github_pull_request already holds a version {} \
                 built from another manifest; the host refuses two manifests under one version",
                version_hash('a')
            ))
        );
    }

    #[tokio::test]
    async fn it_stops_up_before_any_fact_when_the_sql_differs_from_the_columns() {
        let ctx = setup_test();
        let (mut listed, bytes) = build_listed(&version_hash('a'), "[]");

        listed.manifest.schema = listed
            .manifest
            .schema
            .replace("\"title\" TEXT NOT NULL", "\"title\" TEXT");

        let file = write_build(&ctx.config, &[(listed, bytes)]);

        let result = up_listed(&ctx.config, &MemoryLog::seeded(STREAM, &["a"]), &file, None).await;

        assert!(
            matches!(
                &result,
                Err(HostError::Up { source, .. })
                    if matches!(**source, HostError::SchemaMismatch { .. })
            ),
            "{result:?}"
        );
        assert_eq!(
            read_current_version(&ctx.config, "github_pull_request").expect("a read"),
            None
        );
    }

    #[tokio::test]
    async fn it_swaps_a_kept_previous_version_back_in() {
        let ctx = setup_test();
        let log = MemoryLog::seeded(STREAM, &["a"]);
        let (first, first_bytes) = build_listed(&version_hash('a'), "[]");
        let (second, second_bytes) = build_listed(&version_hash('b'), "[ ]");
        let first_file = write_build(&ctx.config, &[(first.clone(), first_bytes)]);

        up_listed(&ctx.config, &log, &first_file, None)
            .await
            .expect("the first up");

        let second_file = write_build(&ctx.config, &[(second, second_bytes)]);

        up_listed(&ctx.config, &log, &second_file, None)
            .await
            .expect("the second up");

        up_kept(&ctx.config, &log, "github_pull_request", &version_hash('a'))
            .await
            .expect("the kept up");

        assert_eq!(
            read_current_version(&ctx.config, "github_pull_request").expect("a read"),
            Some(first.to_version())
        );
    }

    #[tokio::test]
    async fn it_refuses_a_version_whose_table_another_consumers_current_version_owns() {
        let ctx = setup_test();
        let log = MemoryLog::seeded(STREAM, &["a"]);
        let (first, first_bytes) = build_listed(&version_hash('a'), "[]");
        let file = write_build(&ctx.config, &[(first.clone(), first_bytes.clone())]);

        up_listed(&ctx.config, &log, &file, None)
            .await
            .expect("the first up");

        let mut rival = first;

        rival.name = "rival".to_owned();
        rival.manifest.name = "rival".to_owned();

        let file = write_build(&ctx.config, &[(rival, first_bytes)]);

        let result = up_listed(&ctx.config, &log, &file, None).await;

        assert_eq!(
            result.map_err(|error| error.to_string()),
            Err("up rival failed: rival declares the table github_pull_request, which the current version of github_pull_request owns".to_owned())
        );
    }

    #[tokio::test]
    async fn it_refuses_to_start_run_when_a_listed_consumer_has_no_current_version() {
        let ctx = setup_test();
        let (listed, bytes) = build_listed(&version_hash('a'), "[]");

        write_build(&ctx.config, &[(listed, bytes)]);

        let result = start_run(&ctx.config, &MemoryLog::seeded(STREAM, &["a"]), false).await;

        assert_eq!(
            result.map_err(|error| error.to_string()),
            Err(
                "github_pull_request has no current version; run pepys up github_pull_request"
                    .to_owned()
            )
        );
    }

    #[tokio::test]
    async fn it_starts_run_after_up_deploys_every_listed_consumer() {
        let ctx = setup_test();
        let (listed, bytes) = build_listed(&version_hash('a'), "[]");
        let file = write_build(&ctx.config, &[(listed, bytes)]);

        let result = start_run(&ctx.config, &MemoryLog::seeded(STREAM, &["a"]), true).await;

        assert_eq!(result.expect("a start"), file);
    }

    #[tokio::test]
    async fn it_names_the_consumer_when_the_up_of_run_up_fails() {
        let ctx = setup_test();
        let (listed, _) = build_listed(&version_hash('a'), "[]");

        write_build(&ctx.config, &[(listed.clone(), b"(module)".to_vec())]);

        let result = start_run(&ctx.config, &MemoryLog::seeded(STREAM, &["a"]), true).await;

        assert_eq!(
            result.map_err(|error| error.to_string()),
            Err(format!(
                "up github_pull_request failed: the module file of github_pull_request has the hash {}, and the manifest lists {}",
                hash_module(b"(module)"),
                listed.module
            ))
        );
    }

    async fn open_test_version(directory: &Path, runner: CannedRunner) -> Version {
        let manifest = Arc::new(stub_build_manifest().consumers.remove(0).manifest);

        Version {
            store: open_version_store(directory, &manifest)
                .await
                .expect("a store"),
            runner: Runner::Fact(Box::new(runner)),
            manifest,
        }
    }

    fn canned_module() -> CannedRunner {
        CannedRunner::new(&[
            ("a", Ok(upsert_json("github:pull_request:1", "First"))),
            ("b", Ok(upsert_json("github:pull_request:2", "Second"))),
            ("c", Ok(upsert_json("github:pull_request:3", "Third"))),
        ])
    }

    #[tokio::test]
    async fn it_previews_the_current_module_as_no_change_when_the_current_version_is_behind_the_log()
     {
        let ctx = setup_test();
        let (listed, _) = build_listed(&version_hash('a'), "[]");
        let consumer_dir = ctx.config.consumer_dir("github_pull_request");
        let current_dir = consumer_dir.join(version_hash('a'));
        let mut current = open_test_version(&current_dir, canned_module()).await;

        write_version(&current_dir, &listed.to_version()).expect("a version file");
        catch_up(&mut current, &MemoryLog::seeded(STREAM, &["a", "b"]))
            .await
            .expect("the current version at offset 1");
        repoint_current(&consumer_dir, &version_hash('a')).expect("a current link");

        let previewed = open_test_version(&consumer_dir.join("preview"), canned_module()).await;

        let diff = compare_with_current(
            &ctx.config,
            "github_pull_request",
            previewed,
            &MemoryLog::seeded(STREAM, &["a", "b", "c"]),
        )
        .await
        .expect("a diff");

        assert_eq!(diff, json!({}));
    }

    #[tokio::test]
    async fn it_previews_every_row_as_added_when_no_version_is_current() {
        let ctx = setup_test();
        let previewed = open_test_version(
            &ctx.config
                .consumer_dir("github_pull_request")
                .join("preview"),
            canned_module(),
        )
        .await;

        let diff = compare_with_current(
            &ctx.config,
            "github_pull_request",
            previewed,
            &MemoryLog::seeded(STREAM, &["a", "b"]),
        )
        .await
        .expect("a diff");

        assert_eq!(
            diff,
            json!({
                "github_pull_request": {
                    "added": [r#"["github:pull_request:1"]"#, r#"["github:pull_request:2"]"#],
                    "changed": [],
                    "removed": [],
                },
            })
        );
    }

    async fn state_with_current(directory: &Path, version: &str) -> HostState {
        let state = HostState::open(&directory.join("host.db"))
            .await
            .expect("a host state");

        state
            .register("github_pull_request", version)
            .await
            .expect("a registered version");
        state
            .move_to("github_pull_request", version, VersionState::Current)
            .await
            .expect("a current version");

        state
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

    #[tokio::test]
    async fn it_builds_again_an_unfinished_version_whose_version_file_a_crash_cut_short() {
        let ctx = setup_test();
        let (listed, bytes) = build_listed(&version_hash('a'), "[]");
        let file = write_build(&ctx.config, &[(listed.clone(), bytes)]);
        let directory = ctx.config.consumer_dir(&listed.name).join(&listed.version);

        ctx.config
            .host_state()
            .await
            .expect("a host state")
            .register(&listed.name, &listed.version)
            .await
            .expect("a building version");
        std::fs::create_dir_all(&directory).expect("a version folder");
        std::fs::write(directory.join("version.json"), "{\"name\":").expect("a cut short file");

        let report = up_listed(&ctx.config, &MemoryLog::seeded(STREAM, &["a"]), &file, None)
            .await
            .expect("an up");

        assert_eq!(
            report,
            format!("github_pull_request {}: swapped\n", version_hash('a'))
        );
    }

    #[tokio::test]
    async fn it_stops_up_of_a_previous_version_whose_version_file_is_unreadable() {
        let ctx = setup_test();
        let log = MemoryLog::seeded(STREAM, &["a"]);
        let (first, first_bytes) = build_listed(&version_hash('a'), "[]");
        let (second, second_bytes) = build_listed(&version_hash('b'), "[ ]");
        let first_file = write_build(&ctx.config, &[(first.clone(), first_bytes.clone())]);

        up_listed(&ctx.config, &log, &first_file, None)
            .await
            .expect("the first up");
        up_listed(
            &ctx.config,
            &log,
            &write_build(&ctx.config, &[(second, second_bytes)]),
            None,
        )
        .await
        .expect("the second up");
        std::fs::write(
            ctx.config
                .consumer_dir(&first.name)
                .join(&first.version)
                .join("version.json"),
            "{\"name\":",
        )
        .expect("a cut short file");

        let result = up_listed(
            &ctx.config,
            &log,
            &write_build(&ctx.config, &[(first, first_bytes)]),
            None,
        )
        .await;

        assert!(matches!(
            result,
            Err(HostError::Up { source, .. }) if matches!(*source, HostError::BadManifest { .. })
        ));
    }
}
