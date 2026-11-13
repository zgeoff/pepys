use std::collections::BTreeMap;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use tokio::signal::unix::{SignalKind, signal};
use tokio::task::JoinSet;

use crate::batch::{FactRunner, apply_batch};
use crate::consumer::{
    BuildManifest, ConsumerInput, ConsumerManifest, ConsumerVersion, ListedConsumer, TableInfo,
    find_consumer, has_version_file, read_build_manifest, read_version, write_version,
};
use crate::database::{
    Store, checkpoint, open_store, prepare_scope_tables, prepare_store, read_offset,
};
use crate::diff::{diff_json, diff_rows};
use crate::durable::{rename_durably, write_durably};
use crate::error::HostError;
use crate::fact_log::FactLog;
use crate::fact_log::s2::{S2Log, S2Settings};
use crate::lock::WriterLock;
use crate::module_runner::{ModuleRunner, hash_module};
use crate::retry::{Recovery, pick_recovery};
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

    check_module_hash(&version.name, &version.module, &bytes)?;

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

/// Refuses module bytes whose hash is not the one the manifest lists.
fn check_module_hash(consumer: &str, listed: &str, bytes: &[u8]) -> Result<(), HostError> {
    let found = hash_module(bytes);

    if found == listed {
        return Ok(());
    }

    Err(HostError::ModuleHash {
        consumer: consumer.to_owned(),
        listed: listed.to_owned(),
        found,
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

        let Some(count) = pick_read_count(next, stop) else {
            return Ok(applied);
        };
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

/// How many records to read from `next` toward `stop`, at most one batch, or none once `next`
/// reaches `stop`.
fn pick_read_count(next: u64, stop: u64) -> Option<usize> {
    if next >= stop {
        return None;
    }

    Some(usize::try_from(stop - next).map_or(BATCH_SIZE, |left| left.min(BATCH_SIZE)))
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
    rename_durably(&temporary, &consumer_dir.join(CURRENT_LINK))
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
    let linked = std::fs::read_link(consumer_dir.join(CURRENT_LINK)).ok();

    if let Some(version) = pick_link_target(recorded.as_deref(), linked.as_deref()) {
        repoint_current(consumer_dir, version)?;
    }

    Ok(recorded)
}

/// The version that `current` must be repointed at: the recorded current version, when the link
/// follows anything else.
fn pick_link_target<'a>(recorded: Option<&'a str>, linked: Option<&Path>) -> Option<&'a str> {
    recorded.filter(|version| linked != Some(Path::new(version)))
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

        if let Some(table) = find_shared_table(&version.manifest.tables, &current.manifest.tables) {
            return Err(HostError::TableOwned {
                consumer: version.name.clone(),
                table: table.clone(),
                owner,
            });
        }
    }

    Ok(())
}

/// The first table of `tables`, in key order, that `others` also holds.
fn find_shared_table<'a, V>(
    tables: &'a BTreeMap<String, TableInfo>,
    others: &BTreeMap<String, V>,
) -> Option<&'a String> {
    tables.keys().find(|table| others.contains_key(*table))
}

/// Installs the SIGTERM and SIGINT handlers now, and returns a future that ends at the first of
/// the two signals.
///
/// # Errors
/// Fails when a handler cannot be installed.
fn wait_for_stop() -> Result<impl Future<Output = ()>, HostError> {
    let mut terminate = signal(SignalKind::terminate())?;
    let mut interrupt = signal(SignalKind::interrupt())?;

    Ok(async move {
        tokio::select! {
            _ = terminate.recv() => {}
            _ = interrupt.recv() => {}
        }
    })
}

/// Runs every consumer that `consumers.json` lists, one task each, until SIGINT or SIGTERM. With
/// `up_first`, deploys every listed consumer before any task starts, and prints each retry of an
/// `up` that a store or log error failed.
///
/// # Errors
/// Fails before any task starts when the file is refused, an `up` fails with an error that
/// [`pick_recovery`] does not retry, a listed consumer has no current version, or two current
/// versions own one table. Fails after every task has stopped with an error.
pub async fn run(config: &HostConfig, up_first: bool) -> Result<(), HostError> {
    let stop = wait_for_stop()?;
    let log = S2Log::connect(&config.s2)?;
    let on_up_retry = |consumer: &str, error: &HostError, delay: Duration| {
        eprintln!(
            "pepys: up {consumer} retries in {} ms after a store error: {error}",
            delay.as_millis()
        );
    };

    run_until(
        config,
        &log,
        up_first,
        stop,
        on_up_retry,
        tokio::time::sleep,
    )
    .await
}

/// `run` with the stop, the report of an `up` retry and the wait before it as arguments. It
/// returns `Ok` when `stop` ends, during the start or once the tasks run.
async fn run_until(
    config: &HostConfig,
    log: &impl FactLog,
    up_first: bool,
    stop: impl Future<Output = ()>,
    on_up_retry: impl FnMut(&str, &HostError, Duration),
    wait: impl AsyncFn(Duration),
) -> Result<(), HostError> {
    tokio::pin!(stop);

    // A stop during the `up` drops it, in a retry's wait too: each step of a swap leaves a state
    // the next start resumes.
    let file = tokio::select! {
        () = &mut stop => return Ok(()),
        file = start_run(config, log, up_first, on_up_retry, wait) => file?,
    };
    let mut tasks = JoinSet::new();

    for listed in &file.consumers {
        tasks.spawn(run_consumer(config.clone(), listed.name.clone()));
    }

    if tasks.is_empty() {
        stop.await;

        return Ok(());
    }

    loop {
        tokio::select! {
            () = &mut stop => {
                tasks.abort_all();

                return Ok(());
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
    on_up_retry: impl FnMut(&str, &HostError, Duration),
    wait: impl AsyncFn(Duration),
) -> Result<BuildManifest, HostError> {
    let file = config.read_build_manifest()?;

    if up_first {
        print!(
            "{}",
            up_with_retries(config, log, &file, on_up_retry, wait).await?
        );
    }

    let mut owners: BTreeMap<String, String> = BTreeMap::new();

    for listed in &file.consumers {
        let current = read_current_version(config, &listed.name)?
            .ok_or_else(|| HostError::NoCurrentVersion(listed.name.clone()))?;

        if let Some(table) = find_shared_table(&current.manifest.tables, &owners) {
            return Err(HostError::TableOwned {
                consumer: listed.name.clone(),
                table: table.clone(),
                owner: owners[table].clone(),
            });
        }

        for table in current.manifest.tables.keys() {
            owners.insert(table.clone(), listed.name.clone());
        }
    }

    Ok(file)
}

/// One consumer's task on the S2 log, which prints each retry. A failed pass stops this task
/// alone.
async fn run_consumer(config: HostConfig, consumer: String) -> Result<(), HostError> {
    let wrap = |error| HostError::Stopped {
        consumer: consumer.clone(),
        source: Box::new(error),
    };
    let log = S2Log::connect(&config.s2).map_err(wrap)?;

    run_task(&config, &log, &consumer, |error, delay| {
        eprintln!(
            "pepys: {consumer} retries in {} ms after a store error: {error}",
            delay.as_millis()
        );
    })
    .await
    .map_err(wrap)
}

/// On each pass, take the writer lock, open the current version when it changed, and catch up.
/// After a store or log error the batch has rolled back, so the task reopens the version and runs
/// the pass again from the committed offsets, as [`pick_recovery`] decides. Any other error ends
/// the task.
async fn run_task(
    config: &HostConfig,
    log: &impl FactLog,
    consumer: &str,
    mut on_retry: impl FnMut(&HostError, Duration),
) -> Result<(), HostError> {
    let consumer_dir = config.consumer_dir(consumer);
    let mut opened: Option<(String, Version)> = None;
    let mut failures = 0;

    loop {
        let delay = match run_pass(config, log, consumer, &consumer_dir, &mut opened).await {
            Ok(()) => {
                failures = 0;

                POLL_INTERVAL
            }
            Err(error) => {
                failures += 1;

                let Recovery::Retry(delay) = pick_recovery(&error, failures) else {
                    return Err(error);
                };

                // A rollback that failed can leave the connection inside the transaction.
                opened = None;
                on_retry(&error, delay);

                delay
            }
        };

        tokio::time::sleep(delay).await;
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

    if should_open_version(opened.as_ref().map(|(open, _)| open.as_str()), &name) {
        let version = read_version(&directory)?;

        *opened = Some((name, open_version(&directory, &version).await?));
    }

    if let Some((_, version)) = opened.as_mut() {
        catch_up(version, log).await?;
    }

    Ok(())
}

/// Whether a pass opens the current version again: when none is open, or the open one is not it.
fn should_open_version(opened: Option<&str>, current: &str) -> bool {
    opened != Some(current)
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
        report.push_str(
            &up_consumer(config, log, listed)
                .await
                .map_err(|error| to_up_error(listed, error))?,
        );
    }

    Ok(report)
}

/// Deploys every listed consumer in file order, as the `up` of `run --up`. After a store or log
/// error it waits and runs that consumer's `up` again from its start, as [`pick_recovery`]
/// decides, and an `up` that succeeds resets the count for the next consumer. Any other error
/// ends it.
async fn up_with_retries(
    config: &HostConfig,
    log: &impl FactLog,
    file: &BuildManifest,
    mut on_retry: impl FnMut(&str, &HostError, Duration),
    wait: impl AsyncFn(Duration),
) -> Result<String, HostError> {
    let mut report = String::new();

    for listed in &file.consumers {
        let mut failures = 0;

        let swapped = loop {
            match up_consumer(config, log, listed).await {
                Ok(swapped) => break swapped,
                Err(error) => {
                    failures += 1;

                    let Recovery::Retry(delay) = pick_recovery(&error, failures) else {
                        return Err(to_up_error(listed, error));
                    };

                    on_retry(&listed.name, &error, delay);
                    wait(delay).await;
                }
            }
        };

        report.push_str(&swapped);
    }

    Ok(report)
}

async fn up_consumer(
    config: &HostConfig,
    log: &impl FactLog,
    listed: &ListedConsumer,
) -> Result<String, HostError> {
    let bytes = std::fs::read(config.module_path(listed))?;

    check_module_hash(&listed.name, &listed.module, &bytes)?;

    up_version(config, log, &listed.to_version(), &bytes).await
}

fn to_up_error(listed: &ListedConsumer, error: HostError) -> HostError {
    HostError::Up {
        consumer: listed.name.clone(),
        source: Box::new(error),
    }
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

    check_kept_version(
        consumer,
        kept,
        state.state(consumer, kept).await.map_err(wrap)?,
    )
    .map_err(wrap)?;

    let directory = config.consumer_dir(consumer).join(kept);
    let version = read_version(&directory).map_err(wrap)?;
    let bytes = std::fs::read(directory.join(MODULE_FILE)).map_err(|error| wrap(error.into()))?;

    up_version(config, log, &version, &bytes)
        .await
        .map_err(wrap)
}

/// Refuses to swap back in a version `kept` whose recorded state is not previous.
fn check_kept_version(
    consumer: &str,
    kept: &str,
    state: Option<VersionState>,
) -> Result<(), HostError> {
    if state == Some(VersionState::Previous) {
        return Ok(());
    }

    Err(HostError::Config(format!(
        "version {kept} is not a previous version of {consumer}"
    )))
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
            Ok(found) => check_same_version(&found, version)?,
            Err(error) => {
                // An unfinished build starts again below, whatever its version file holds.
                let state = config.host_state().await?.state(consumer, name).await?;

                if !is_unfinished(state) {
                    return Err(error);
                }
            }
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

    if pick_build_start(name, state.state(consumer, name).await?)? == BuildStart::Again {
        if directory.exists() {
            std::fs::remove_dir_all(&directory)?;
        }

        state.register(consumer, name).await?;
    }

    std::fs::create_dir_all(&directory)?;
    write_durably(&directory.join(MODULE_FILE), bytes)?;
    write_version(&directory, version)?;

    let mut opened = open_version(&directory, version).await?;

    // Replay while the live version keeps writing, then pause its writer for the last stretch.
    catch_up(&mut opened, log).await?;

    let _lock = WriterLock::acquire(&consumer_dir, LOCK_WAIT).await?;
    // The state is read again under the lock: another `up` may have swapped a version in since.
    let state = config.host_state().await?;
    let current = reconcile_current(&consumer_dir, &state, consumer).await?;

    if is_current_version(current.as_deref(), name) {
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

/// Refuses a version file that holds another manifest under the version's name.
fn check_same_version(found: &ConsumerVersion, version: &ConsumerVersion) -> Result<(), HostError> {
    if found == version {
        return Ok(());
    }

    Err(HostError::VersionClash {
        consumer: version.name.clone(),
        version: version.version.clone(),
    })
}

/// Whether a version in `state` is a build that never finished, which `up` builds again from the
/// first record.
fn is_unfinished(state: Option<VersionState>) -> bool {
    matches!(
        state,
        None | Some(VersionState::Building | VersionState::Previewed)
    )
}

/// How `up` starts the build of a version folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BuildStart {
    /// A kept previous version: its folder is built on.
    Kept,
    /// A build that never finished, or a new one: it starts again from the first record.
    Again,
}

/// How `up` starts the build of the version `name` in `state`. A removed version is refused.
fn pick_build_start(name: &str, state: Option<VersionState>) -> Result<BuildStart, HostError> {
    match state {
        Some(VersionState::Previous) => Ok(BuildStart::Kept),
        Some(VersionState::Removed) => {
            Err(HostError::Config(format!("version {name} was removed")))
        }
        Some(VersionState::Building | VersionState::Previewed | VersionState::Current) | None => {
            Ok(BuildStart::Again)
        }
    }
}

/// Whether `version` is the `current` version that `host.db` records.
fn is_current_version(current: Option<&str>, version: &str) -> bool {
    current == Some(version)
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

    if !is_current_version(current.as_deref(), &version.version) {
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
/// current version, where each row of a table that `previewed` drops shows as removed. With no
/// current version, it replays to the log's tail.
async fn compare_with_current(
    config: &HostConfig,
    consumer: &str,
    mut previewed: Version,
    log: &impl FactLog,
) -> Result<serde_json::Value, HostError> {
    // The previewed version stops where the current one stands, so records that only the
    // previewed version has read never show as a change.
    let current = read_current_version(config, consumer)?;
    let (before, stops) = if let Some(current) = &current {
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

    build_preview_diff(
        &previewed.manifest.tables,
        current.as_ref().map(|current| &current.manifest.tables),
        &before,
        &after,
    )
}

/// The preview's row diff of each previewed table, from the current rows `before` to the
/// previewed rows `after`, where each row of a current table that `previewed` drops shows as
/// removed.
fn build_preview_diff(
    previewed: &BTreeMap<String, TableInfo>,
    current: Option<&BTreeMap<String, TableInfo>>,
    before: &TableRows,
    after: &TableRows,
) -> Result<serde_json::Value, HostError> {
    let mut diffs = Vec::new();

    for (table, info) in previewed {
        let empty = Vec::new();
        let current = before.get(table).unwrap_or(&empty);
        let rows = after.get(table).unwrap_or(&empty);

        diffs.push((table.clone(), diff_rows(table, info, current, rows)?));
    }

    let removed_tables = current
        .into_iter()
        .flatten()
        .filter(|(table, _)| !previewed.contains_key(*table));

    for (table, info) in removed_tables {
        let rows = before.get(table).map_or(&[][..], Vec::as_slice);

        diffs.push((table.clone(), diff_rows(table, info, rows, &[])?));
    }

    Ok(diff_json(&diffs))
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicU32, Ordering};

    use s2_sdk::S2;
    use serde_json::json;

    use super::*;
    use crate::durable::rename_fault;
    use crate::fact_log::memory::MemoryLog;
    use crate::fact_log::s2::{build_append_config, build_config};
    use crate::test_utils::stub_s2::{STUB_S2_HOST, TurmoilConnector, WRITER_HOST};
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

    /// A log whose every call waits forever, so an `up` on it never ends.
    struct StalledLog;

    impl FactLog for StalledLog {
        async fn append_batch(
            &self,
            _stream: &str,
            _bodies: &[String],
            _expected_tail: u64,
        ) -> Result<crate::fact_log::AppendOutcome, HostError> {
            std::future::pending().await
        }

        async fn read(
            &self,
            _stream: &str,
            _from: u64,
            _count: usize,
        ) -> Result<Vec<crate::fact_log::StoredFact>, HostError> {
            std::future::pending().await
        }

        async fn read_tail(&self, _stream: &str) -> Result<u64, HostError> {
            std::future::pending().await
        }
    }

    #[tokio::test]
    async fn it_stops_cleanly_when_the_stop_comes_during_the_up() {
        let ctx = setup_test();
        let (listed, bytes) = build_listed(&version_hash('a'), "[]");

        write_build(&ctx.config, &[(listed.clone(), bytes)]);

        let stopped = tokio::time::timeout(
            Duration::from_secs(2),
            run_until(
                &ctx.config,
                &StalledLog,
                true,
                std::future::ready(()),
                |_, _, _| {},
                async |_| {},
            ),
        )
        .await
        .expect("a run that ends before its up does");

        stopped.expect("a clean stop");
        assert!(
            read_current_version(&ctx.config, &listed.name)
                .expect("a readable store")
                .is_none()
        );
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

        let result = start_run(
            &ctx.config,
            &MemoryLog::seeded(STREAM, &["a"]),
            false,
            |_, _, _| {},
            async |_| {},
        )
        .await;

        assert_eq!(
            result.map_err(|error| error.to_string()),
            Err(
                "github_pull_request has no current version; run pepys up github_pull_request"
                    .to_owned()
            )
        );
    }

    /// Ups the stub consumer with a module that returns `output` on a log with no facts, and opens
    /// its current file.
    #[test]
    fn it_retries_the_up_of_run_up_that_s2_refuses_a_connection_until_the_stop() {
        let ctx = setup_test();
        let (listed, bytes) = build_listed(&version_hash('a'), "[]");

        write_build(&ctx.config, &[(listed, bytes)]);

        let config = ctx.config.clone();
        let retries = Arc::new(Mutex::new(Vec::new()));
        let recorded = Arc::clone(&retries);
        let ended = Arc::new(Mutex::new(None));
        let returned = Arc::clone(&ended);
        let mut sim = turmoil::Builder::new()
            .simulation_duration(Duration::from_secs(60))
            .build();

        // A host with no listener refuses each connection.
        sim.host(STUB_S2_HOST, std::future::pending::<turmoil::Result>);
        sim.client(WRITER_HOST, async move {
            let settings = S2Settings {
                endpoint: format!("http://{STUB_S2_HOST}"),
                access_token: "unused".to_owned(),
                basin: "conformance".to_owned(),
            };
            let reader = S2::new_with_connector(build_config(&settings)?, TurmoilConnector)?;
            let writer = S2::new_with_connector(build_append_config(&settings)?, TurmoilConnector)?;
            let log = S2Log::from_clients(&reader, &writer, &settings.basin)?;
            let stop = tokio::sync::Notify::new();

            let result = run_until(
                &config,
                &log,
                true,
                stop.notified(),
                |consumer, error, delay| {
                    recorded.lock().expect("the retries").push((
                        consumer.to_owned(),
                        error.to_string(),
                        delay,
                    ));
                    stop.notify_one();
                },
                |_| std::future::pending(),
            )
            .await;

            *returned.lock().expect("the result") = Some(result.map_err(|error| error.to_string()));

            Ok(())
        });

        sim.run().expect("the simulation");

        assert_eq!(
            (
                ended.lock().expect("the result").clone(),
                retries.lock().expect("the retries").clone()
            ),
            (
                Some(Ok(())),
                vec![(
                    "github_pull_request".to_owned(),
                    "s2: connection refused: 192.168.0.1:80 -> send error: client error (Connect)"
                        .to_owned(),
                    Duration::from_millis(200)
                )]
            )
        );
    }

    /// A log that refuses each read until it has refused `refusals` of them, with the error of a
    /// refused S2 connection, then reads `log`.
    struct RefusingLog {
        refusals: AtomicU32,
        log: MemoryLog,
    }

    impl RefusingLog {
        fn refusing(refusals: u32) -> Self {
            Self {
                refusals: AtomicU32::new(refusals),
                log: MemoryLog::seeded(STREAM, &["a"]),
            }
        }

        fn refuse(&self) -> Result<(), HostError> {
            let left = self.refusals.load(Ordering::Relaxed);

            if left == 0 {
                return Ok(());
            }

            self.refusals.store(left - 1, Ordering::Relaxed);

            Err(HostError::Stream("connection refused".to_owned()))
        }
    }

    impl FactLog for RefusingLog {
        async fn append_batch(
            &self,
            stream: &str,
            bodies: &[String],
            expected_tail: u64,
        ) -> Result<crate::fact_log::AppendOutcome, HostError> {
            self.log.append_batch(stream, bodies, expected_tail).await
        }

        async fn read(
            &self,
            stream: &str,
            from: u64,
            count: usize,
        ) -> Result<Vec<crate::fact_log::StoredFact>, HostError> {
            self.refuse()?;
            self.log.read(stream, from, count).await
        }

        async fn read_tail(&self, stream: &str) -> Result<u64, HostError> {
            self.refuse()?;
            self.log.read_tail(stream).await
        }
    }

    #[tokio::test]
    async fn it_swaps_the_listed_version_in_once_the_log_of_run_up_stops_refusing_reads() {
        let ctx = setup_test();
        let (listed, bytes) = build_listed(&version_hash('a'), "[]");
        let file = write_build(&ctx.config, &[(listed, bytes)]);
        let mut retries = Vec::new();

        let result = start_run(
            &ctx.config,
            &RefusingLog::refusing(2),
            true,
            |consumer, error, delay| {
                retries.push((consumer.to_owned(), error.to_string(), delay));
            },
            async |_| {},
        )
        .await;

        assert_eq!(
            (result.map_err(|error| error.to_string()), retries),
            (
                Ok(file),
                vec![
                    (
                        "github_pull_request".to_owned(),
                        "s2: connection refused".to_owned(),
                        Duration::from_millis(200)
                    ),
                    (
                        "github_pull_request".to_owned(),
                        "s2: connection refused".to_owned(),
                        Duration::from_millis(400)
                    )
                ]
            )
        );
        assert_eq!(
            read_current_version(&ctx.config, "github_pull_request")
                .expect("a read")
                .map(|current| current.version),
            Some(version_hash('a'))
        );
    }

    #[tokio::test]
    async fn it_fails_a_one_shot_up_at_the_first_read_the_log_refuses() {
        let ctx = setup_test();
        let (listed, bytes) = build_listed(&version_hash('a'), "[]");
        let file = write_build(&ctx.config, &[(listed, bytes)]);
        let log = RefusingLog::refusing(5);

        let result = up_listed(&ctx.config, &log, &file, None).await;

        assert_eq!(
            (
                result.map_err(|error| error.to_string()),
                log.refusals.load(Ordering::Relaxed)
            ),
            (
                Err("up github_pull_request failed: s2: connection refused".to_owned()),
                4
            )
        );
    }

    #[tokio::test]
    async fn it_ends_the_up_of_run_up_with_no_retry_when_another_consumer_owns_its_table() {
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
        write_build(&ctx.config, &[(rival, first_bytes)]);

        let mut retries = Vec::new();

        let result = start_run(
            &ctx.config,
            &log,
            true,
            |_, error, _| retries.push(error.to_string()),
            async |_| {},
        )
        .await;

        assert_eq!(
            (result.map_err(|error| error.to_string()), retries),
            (
                Err("up rival failed: rival declares the table github_pull_request, which the current version of github_pull_request owns".to_owned()),
                Vec::new()
            )
        );
    }

    async fn up_with_no_facts(config: &HostConfig, output: &str) -> (Store, BuildManifest) {
        let (listed, bytes) = build_listed(&version_hash('a'), output);
        let file = write_build(config, &[(listed, bytes)]);

        up_listed(config, &MemoryLog::seeded(STREAM, &[]), &file, None)
            .await
            .expect("an up");

        let directory = current_version_dir(&config.consumer_dir("github_pull_request"))
            .expect("a current version");
        let store = open_store(&directory.join(DATABASE_FILE))
            .await
            .expect("the store");

        (store, file)
    }

    #[tokio::test]
    async fn it_runs_a_batch_again_after_a_store_error_and_applies_it() {
        let ctx = setup_test();
        let (store, file) =
            up_with_no_facts(&ctx.config, &upsert_json("github:pull_request:7", "Tides")).await;
        let log = MemoryLog::seeded(STREAM, &["a"]);
        let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();

        store
            .connection
            .execute("DROP TABLE change_log", ())
            .await
            .expect("the drop");

        let task = run_task(&ctx.config, &log, "github_pull_request", |error, _| {
            drop(sender.send(error.to_string()));
        });
        let repair = async {
            let first = receiver.recv().await;

            store
                .connection
                .execute(
                    "CREATE TABLE change_log (batch INTEGER NOT NULL PRIMARY KEY, changes TEXT NOT NULL)",
                    (),
                )
                .await
                .expect("the table again");

            while read_offset(&store, STREAM)
                .await
                .expect("an offset")
                .is_none()
            {
                tokio::time::sleep(POLL_INTERVAL).await;
            }

            first
        };
        let first_retry = tokio::time::timeout(Duration::from_secs(5), async {
            tokio::select! {
                ended = task => Err(ended.map_err(|error| error.to_string())),
                first = repair => Ok(first),
            }
        })
        .await
        .expect("a retry that applies the batch within 5 s");

        assert_eq!(
            first_retry,
            Ok(Some(
                "database: Parse error: no such table: change_log".to_owned()
            ))
        );
        assert_eq!(
            read_all_tables(&store, &file.consumers[0].manifest)
                .await
                .expect("the rows")["github_pull_request"]
                .iter()
                .map(|row| row["title"].clone())
                .collect::<Vec<_>>(),
            vec![json!("Tides")]
        );
    }

    #[tokio::test]
    async fn it_ends_the_task_with_no_retry_when_the_host_refuses_the_consumers_output() {
        let ctx = setup_test();
        let (store, _) = up_with_no_facts(&ctx.config, "{}").await;
        let mut retries: Vec<String> = Vec::new();

        let result = run_task(
            &ctx.config,
            &MemoryLog::seeded(STREAM, &["a"]),
            "github_pull_request",
            |error, _| retries.push(error.to_string()),
        )
        .await;

        assert_eq!(
            (result.map_err(|error| error.to_string()), retries),
            (
                Err(
                    "the consumer returned an operation the host cannot read: the output is not a JSON list"
                        .to_owned()
                ),
                Vec::new()
            )
        );
        assert_eq!(read_offset(&store, STREAM).await.expect("an offset"), None);
    }

    #[tokio::test]
    async fn it_starts_run_after_up_deploys_every_listed_consumer() {
        let ctx = setup_test();
        let (listed, bytes) = build_listed(&version_hash('a'), "[]");
        let file = write_build(&ctx.config, &[(listed, bytes)]);

        let result = start_run(
            &ctx.config,
            &MemoryLog::seeded(STREAM, &["a"]),
            true,
            |_, _, _| {},
            async |_| {},
        )
        .await;

        assert_eq!(result.expect("a start"), file);
    }

    #[tokio::test]
    async fn it_names_the_consumer_and_never_retries_when_the_up_of_run_up_finds_a_bad_module() {
        let ctx = setup_test();
        let (listed, _) = build_listed(&version_hash('a'), "[]");

        write_build(&ctx.config, &[(listed.clone(), b"(module)".to_vec())]);

        let mut retries = Vec::new();

        let result = start_run(
            &ctx.config,
            &MemoryLog::seeded(STREAM, &["a"]),
            true,
            |_, error, _| retries.push(error.to_string()),
            async |_| {},
        )
        .await;

        assert_eq!(
            (result.map_err(|error| error.to_string()), retries),
            (
                Err(format!(
                    "up github_pull_request failed: the module file of github_pull_request has the hash {}, and the manifest lists {}",
                    hash_module(b"(module)"),
                    listed.module
                )),
                Vec::new()
            )
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
    async fn it_previews_each_row_of_a_table_the_new_version_drops_as_removed() {
        let ctx = setup_test();
        let (listed, _) = build_listed(&version_hash('a'), "[]");
        let log = MemoryLog::seeded(STREAM, &["a"]);
        let consumer_dir = ctx.config.consumer_dir("github_pull_request");
        let current_dir = consumer_dir.join(version_hash('a'));
        let mut current = open_test_version(&current_dir, canned_module()).await;
        let mut manifest = listed.manifest.clone();

        write_version(&current_dir, &listed.to_version()).expect("a version file");
        catch_up(&mut current, &log)
            .await
            .expect("the current rows");
        repoint_current(&consumer_dir, &version_hash('a')).expect("a current link");
        manifest.tables.remove("github_pull_request");
        manifest.tables.remove("github_pull_request_alias");
        manifest.imports.clear();
        manifest.schema = "CREATE TABLE \"github_release_bump\" (\"pull_request_id\" TEXT NOT \
                           NULL, \"release_repository\" TEXT NOT NULL, \"release_tag\" TEXT NOT \
                           NULL, PRIMARY KEY (\"pull_request_id\", \"release_repository\", \
                           \"release_tag\"));"
            .to_owned();

        let manifest = Arc::new(manifest);
        let previewed = Version {
            store: open_version_store(&consumer_dir.join("preview"), &manifest)
                .await
                .expect("a preview store"),
            runner: Runner::Fact(Box::new(CannedRunner::new(&[("a", Ok("[]".to_owned()))]))),
            manifest,
        };

        let diff = compare_with_current(&ctx.config, "github_pull_request", previewed, &log)
            .await
            .expect("a diff");

        assert_eq!(
            diff,
            json!({
                "github_pull_request": {
                    "added": [],
                    "changed": [],
                    "removed": [r#"["github:pull_request:1"]"#],
                },
            })
        );
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

    #[tokio::test]
    async fn it_creates_the_current_link_that_an_interrupted_swap_never_made() {
        let ctx = setup_test();
        let log = MemoryLog::seeded(STREAM, &["a"]);
        let (listed, bytes) = build_listed(&version_hash('a'), "[]");
        let file = write_build(&ctx.config, &[(listed.clone(), bytes)]);
        let link = ctx.config.consumer_dir(&listed.name).join(CURRENT_LINK);

        rename_fault::arm(&link);
        up_listed(&ctx.config, &log, &file, None)
            .await
            .expect_err("an up stopped before its link");

        let report = up_listed(&ctx.config, &log, &file, None)
            .await
            .expect("an up");

        assert_eq!(
            report,
            format!(
                "github_pull_request {}: no swap, the version is current\n",
                version_hash('a')
            )
        );
        assert_eq!(
            std::fs::read_link(&link).expect("a link"),
            Path::new(&listed.version)
        );
    }

    #[tokio::test]
    async fn it_repoints_a_current_link_that_follows_an_older_version() {
        let ctx = setup_test();
        let log = MemoryLog::seeded(STREAM, &["a"]);
        let (first, first_bytes) = build_listed(&version_hash('a'), "[]");
        let (second, second_bytes) = build_listed(&version_hash('b'), "[ ]");
        let link = ctx.config.consumer_dir(&second.name).join(CURRENT_LINK);

        up_listed(
            &ctx.config,
            &log,
            &write_build(&ctx.config, &[(first, first_bytes)]),
            None,
        )
        .await
        .expect("the first up");
        let second_file = write_build(&ctx.config, &[(second.clone(), second_bytes)]);
        rename_fault::arm(&link);
        up_listed(&ctx.config, &log, &second_file, None)
            .await
            .expect_err("an up stopped before its link");

        let report = up_listed(&ctx.config, &log, &second_file, None)
            .await
            .expect("an up");

        assert_eq!(
            report,
            format!(
                "github_pull_request {}: no swap, the version is current\n",
                version_hash('b')
            )
        );
        assert_eq!(
            std::fs::read_link(&link).expect("a link"),
            Path::new(&second.version)
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
    async fn it_builds_again_an_unfinished_version_whose_version_file_is_corrupt() {
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
        std::fs::write(directory.join("version.json"), "{\"name\":").expect("a corrupt file");

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
        .expect("a corrupt file");

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

    #[test]
    fn it_picks_the_recorded_version_as_the_link_target_only_when_the_link_follows_another() {
        let cases = [
            ("no recorded version and no link", None, None),
            ("no recorded version and a link", None, Some("old123")),
            ("a recorded version and no link", Some("new456"), None),
            ("a link to an older version", Some("new456"), Some("old123")),
            (
                "a link to the recorded version",
                Some("new456"),
                Some("new456"),
            ),
        ];

        let picked: Vec<(&str, Option<&str>)> = cases
            .into_iter()
            .map(|(case, recorded, linked)| {
                (case, pick_link_target(recorded, linked.map(Path::new)))
            })
            .collect();

        assert_eq!(
            picked,
            vec![
                ("no recorded version and no link", None),
                ("no recorded version and a link", None),
                ("a recorded version and no link", Some("new456")),
                ("a link to an older version", Some("new456")),
                ("a link to the recorded version", None),
            ]
        );
    }

    #[test]
    fn it_opens_the_current_version_again_unless_it_is_the_open_one() {
        let cases = [
            ("no open version", None),
            ("another open version", Some("old123")),
            ("the current version open", Some("new456")),
        ];

        let opened: Vec<(&str, bool)> = cases
            .into_iter()
            .map(|(case, open)| (case, should_open_version(open, "new456")))
            .collect();

        assert_eq!(
            opened,
            vec![
                ("no open version", true),
                ("another open version", true),
                ("the current version open", false),
            ]
        );
    }

    fn build_tables(names: &[&str]) -> BTreeMap<String, TableInfo> {
        names
            .iter()
            .map(|name| {
                let info = serde_json::from_value(json!({
                    "columns": {
                        "id": {"kind": "text", "nullable": false},
                        "title": {"kind": "text", "nullable": false}
                    },
                    "primaryKey": ["id"],
                    "indexes": []
                }))
                .expect("a table");

                ((*name).to_owned(), info)
            })
            .collect()
    }

    fn build_rows(rows: &[(&str, &str, &str)]) -> TableRows {
        let mut tables = TableRows::new();

        for (table, id, title) in rows {
            let row = serde_json::from_value(json!({"id": id, "title": title})).expect("a row");

            tables.entry((*table).to_owned()).or_default().push(row);
        }

        tables
    }

    #[test]
    fn it_finds_the_first_table_in_key_order_that_another_consumer_holds() {
        let cases = [
            ("no shared table", &["item", "note"][..], &["ledger"][..]),
            ("one shared table", &["item", "note"][..], &["note"][..]),
            (
                "two shared tables",
                &["note", "item"][..],
                &["note", "item"][..],
            ),
        ];

        let found: Vec<(&str, Option<String>)> = cases
            .into_iter()
            .map(|(case, tables, others)| {
                let shared =
                    find_shared_table(&build_tables(tables), &build_tables(others)).cloned();

                (case, shared)
            })
            .collect();

        assert_eq!(
            found,
            vec![
                ("no shared table", None),
                ("one shared table", Some("note".to_owned())),
                ("two shared tables", Some("item".to_owned())),
            ]
        );
    }

    #[tokio::test]
    async fn it_refuses_to_start_run_when_two_current_versions_own_one_table() {
        let ctx = setup_test();
        let log = MemoryLog::seeded(STREAM, &["a"]);
        let (first, bytes) = build_listed(&version_hash('a'), "[]");
        let mut listed_rival: ListedConsumer = serde_json::from_str(
            &serde_json::to_string(&first)
                .expect("JSON")
                .replace("github_pull_request", "rival")
                .replace("github_release_bump", "rival_bump"),
        )
        .expect("a rival consumer");
        let mut current_rival = first.to_version();

        listed_rival.path = "rival/module.wasm".to_owned();
        current_rival.name = "rival".to_owned();
        current_rival.manifest.name = "rival".to_owned();

        let file = write_build(&ctx.config, &[(first, bytes.clone())]);

        up_listed(&ctx.config, &log, &file, None)
            .await
            .expect("the first up");

        let rival_dir = ctx.config.consumer_dir("rival").join(version_hash('a'));

        std::fs::create_dir_all(&rival_dir).expect("a rival version folder");
        write_version(&rival_dir, &current_rival).expect("a rival version file");
        repoint_current(&ctx.config.consumer_dir("rival"), &version_hash('a'))
            .expect("a rival current link");
        write_build(
            &ctx.config,
            &[
                (file.consumers[0].clone(), bytes.clone()),
                (listed_rival, bytes),
            ],
        );

        let result = start_run(&ctx.config, &log, false, |_, _, _| {}, async |_| {}).await;

        assert_eq!(
            result.map(|_| ()).map_err(|error| error.to_string()),
            Err(
                "rival declares the table github_pull_request, which the current version of \
                 github_pull_request owns"
                    .to_owned()
            )
        );
    }

    #[test]
    fn it_builds_the_preview_diff_of_each_table_and_of_each_table_the_preview_drops() {
        let cases = [
            (
                "no current version",
                build_tables(&["item"]),
                None,
                build_rows(&[]),
                build_rows(&[("item", "a", "First")]),
            ),
            (
                "the same rows",
                build_tables(&["item"]),
                Some(build_tables(&["item"])),
                build_rows(&[("item", "a", "First")]),
                build_rows(&[("item", "a", "First")]),
            ),
            (
                "a changed row",
                build_tables(&["item"]),
                Some(build_tables(&["item"])),
                build_rows(&[("item", "a", "First")]),
                build_rows(&[("item", "a", "Second")]),
            ),
            (
                "a table the preview drops",
                build_tables(&["item"]),
                Some(build_tables(&["item", "note"])),
                build_rows(&[("item", "a", "First"), ("note", "n", "Kept")]),
                build_rows(&[("item", "a", "First")]),
            ),
        ];

        let diffs: Vec<(&str, serde_json::Value)> = cases
            .into_iter()
            .map(|(case, previewed, current, before, after)| {
                let diff = build_preview_diff(&previewed, current.as_ref(), &before, &after)
                    .expect("a diff");

                (case, diff)
            })
            .collect();

        assert_eq!(
            diffs,
            vec![
                (
                    "no current version",
                    json!({"item": {"added": [r#"["a"]"#], "changed": [], "removed": []}})
                ),
                ("the same rows", json!({})),
                (
                    "a changed row",
                    json!({"item": {"added": [], "changed": [r#"["a"]"#], "removed": []}})
                ),
                (
                    "a table the preview drops",
                    json!({"note": {"added": [], "changed": [], "removed": [r#"["n"]"#]}})
                ),
            ]
        );
    }

    #[test]
    fn it_refuses_a_version_file_only_when_it_holds_another_manifest() {
        let (listed, _) = build_listed(&version_hash('a'), "[]");
        let version = listed.to_version();
        let mut other = version.clone();

        other.manifest.schema.push('\n');

        let cases = [
            ("the same manifest", &version),
            ("another manifest", &other),
        ];

        let checked: Vec<(&str, Result<(), String>)> = cases
            .into_iter()
            .map(|(case, found)| {
                (
                    case,
                    check_same_version(found, &version).map_err(|error| error.to_string()),
                )
            })
            .collect();

        assert_eq!(
            checked,
            vec![
                ("the same manifest", Ok(())),
                (
                    "another manifest",
                    Err(format!(
                        "github_pull_request already holds a version {} built from another \
                         manifest; the host refuses two manifests under one version",
                        version_hash('a')
                    ))
                ),
            ]
        );
    }

    #[test]
    fn it_counts_a_version_as_unfinished_only_before_it_was_ever_current() {
        let cases = [
            ("not recorded", None),
            ("building", Some(VersionState::Building)),
            ("previewed", Some(VersionState::Previewed)),
            ("current", Some(VersionState::Current)),
            ("previous", Some(VersionState::Previous)),
            ("removed", Some(VersionState::Removed)),
        ];

        let unfinished: Vec<(&str, bool)> = cases
            .into_iter()
            .map(|(case, state)| (case, is_unfinished(state)))
            .collect();

        assert_eq!(
            unfinished,
            vec![
                ("not recorded", true),
                ("building", true),
                ("previewed", true),
                ("current", false),
                ("previous", false),
                ("removed", false),
            ]
        );
    }

    #[test]
    fn it_picks_how_a_build_starts_from_the_recorded_state() {
        let cases = [
            ("not recorded", None),
            ("building", Some(VersionState::Building)),
            ("previewed", Some(VersionState::Previewed)),
            ("current", Some(VersionState::Current)),
            ("previous", Some(VersionState::Previous)),
            ("removed", Some(VersionState::Removed)),
        ];

        let picked: Vec<(&str, Result<BuildStart, String>)> = cases
            .into_iter()
            .map(|(case, state)| {
                (
                    case,
                    pick_build_start("abc123", state).map_err(|error| error.to_string()),
                )
            })
            .collect();

        assert_eq!(
            picked,
            vec![
                ("not recorded", Ok(BuildStart::Again)),
                ("building", Ok(BuildStart::Again)),
                ("previewed", Ok(BuildStart::Again)),
                ("current", Ok(BuildStart::Again)),
                ("previous", Ok(BuildStart::Kept)),
                ("removed", Err("version abc123 was removed".to_owned())),
            ]
        );
    }

    #[test]
    fn it_swaps_back_in_only_a_version_recorded_as_previous() {
        let cases = [
            ("not recorded", None),
            ("building", Some(VersionState::Building)),
            ("previewed", Some(VersionState::Previewed)),
            ("current", Some(VersionState::Current)),
            ("previous", Some(VersionState::Previous)),
            ("removed", Some(VersionState::Removed)),
        ];

        let checked: Vec<(&str, Result<(), String>)> = cases
            .into_iter()
            .map(|(case, state)| {
                (
                    case,
                    check_kept_version("github_pull_request", "abc123", state)
                        .map_err(|error| error.to_string()),
                )
            })
            .collect();
        let refused =
            || Err("version abc123 is not a previous version of github_pull_request".to_owned());

        assert_eq!(
            checked,
            vec![
                ("not recorded", refused()),
                ("building", refused()),
                ("previewed", refused()),
                ("current", refused()),
                ("previous", Ok(())),
                ("removed", refused()),
            ]
        );
    }

    #[test]
    fn it_counts_a_version_as_current_only_when_host_db_records_it() {
        let cases = [
            ("no current version", None),
            ("another current version", Some("old123")),
            ("this version current", Some("new456")),
        ];

        let current: Vec<(&str, bool)> = cases
            .into_iter()
            .map(|(case, recorded)| (case, is_current_version(recorded, "new456")))
            .collect();

        assert_eq!(
            current,
            vec![
                ("no current version", false),
                ("another current version", false),
                ("this version current", true),
            ]
        );
    }

    #[test]
    fn it_picks_a_read_count_of_at_most_one_batch_until_the_stop() {
        let cases = [
            ("next past the stop", 9, 4),
            ("next at the stop", 4, 4),
            ("one record left", 3, 4),
            ("one batch left", 0, 100),
            ("more than one batch left", 0, 250),
        ];

        let picked: Vec<(&str, Option<usize>)> = cases
            .into_iter()
            .map(|(case, next, stop)| (case, pick_read_count(next, stop)))
            .collect();

        assert_eq!(
            picked,
            vec![
                ("next past the stop", None),
                ("next at the stop", None),
                ("one record left", Some(1)),
                ("one batch left", Some(100)),
                ("more than one batch left", Some(100)),
            ]
        );
    }

    #[test]
    fn it_refuses_module_bytes_only_when_their_hash_is_not_the_listed_one() {
        let listed = hash_module(b"(module)");
        let cases: [(&str, &[u8]); 2] = [
            ("the listed bytes", b"(module)"),
            ("other bytes", b"(module $other)"),
        ];

        let checked: Vec<(&str, Result<(), String>)> = cases
            .into_iter()
            .map(|(case, bytes)| {
                (
                    case,
                    check_module_hash("github_pull_request", &listed, bytes)
                        .map_err(|error| error.to_string()),
                )
            })
            .collect();

        assert_eq!(
            checked,
            vec![
                ("the listed bytes", Ok(())),
                (
                    "other bytes",
                    Err(format!(
                        "the module file of github_pull_request has the hash {}, and the manifest \
                         lists {listed}",
                        hash_module(b"(module $other)")
                    ))
                ),
            ]
        );
    }
}
