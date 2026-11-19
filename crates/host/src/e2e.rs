//! The `e2e` lane: the fact log fixtures on s2-lite and the blob store fixtures on Garage, in the
//! stack that `bun run test:e2e:rust` starts and names in the `PEPYS_` variables.

#![allow(clippy::expect_used)]

use s2_sdk::S2;
use s2_sdk::types::{CreateBasinInput, CreateStreamInput, RetentionPolicy, StreamConfig};

use crate::blob_store::garage::{GarageBlobStore, GarageSettings};
use crate::fact_log::s2::{S2Log, S2Settings, build_config};

fn read_variable(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("{name} is set: run bun run test:e2e:rust"))
}

/// A log on a basin of its own that holds `streams`, each with infinite retention as pepys
/// creates every stream.
async fn create_s2_log(basin: &str, streams: &[String]) -> S2Log {
    let settings = S2Settings {
        endpoint: read_variable("PEPYS_S2_ENDPOINT"),
        access_token: read_variable("PEPYS_S2_ACCESS_TOKEN"),
        basin: basin.to_owned(),
    };
    let client = S2::new(build_config(&settings).expect("a config")).expect("a client");
    let basin_name = basin.parse().expect("a basin name");

    client
        .create_basin(CreateBasinInput::new(basin_name))
        .await
        .expect("a basin");

    let log = S2Log::connect(&settings).expect("a log");
    let created = client.basin(basin.parse().expect("a basin name"));

    for stream in streams {
        let config = StreamConfig::new().with_retention_policy(RetentionPolicy::Infinite);

        created
            .create_stream(
                CreateStreamInput::new(stream.parse().expect("a stream name")).with_config(config),
            )
            .await
            .expect("a stream");
    }

    log
}

fn connect_garage() -> GarageBlobStore {
    GarageBlobStore::connect(&GarageSettings {
        endpoint: read_variable("PEPYS_GARAGE_ENDPOINT"),
        region: read_variable("PEPYS_GARAGE_REGION"),
        bucket: read_variable("PEPYS_GARAGE_BUCKET"),
        access_key_id: read_variable("PEPYS_GARAGE_ACCESS_KEY_ID"),
        secret_access_key: read_variable("PEPYS_GARAGE_SECRET_ACCESS_KEY"),
        request_timeout: std::time::Duration::from_secs(5),
    })
    .expect("a Garage client")
}

mod fact_log_s2 {
    use super::create_s2_log;
    use crate::fact_log::fixtures::{Fixture, run_fact_log_fixture};

    macro_rules! s2_lite_tests {
        ($($name:ident => $file:literal),* $(,)?) => {$(
            #[tokio::test]
            async fn $name() {
                let fixture = Fixture::find($file);
                let basin = format!("conformance-{}", $file.trim_end_matches(".json"));
                let log = create_s2_log(&basin, &fixture.streams).await;

                let returned = run_fact_log_fixture(&log, &fixture).await;

                assert_eq!(returned, fixture.expected_returns());
            }
        )*};
    }

    crate::fact_log::fixtures::for_each_fact_log_fixture!(s2_lite_tests);
}

mod blob_store_garage {
    use super::connect_garage;
    use crate::blob_store::fixtures::{Fixture, run_blob_store_fixture};

    macro_rules! garage_tests {
        ($($name:ident => $file:literal),* $(,)?) => {$(
            #[tokio::test]
            async fn $name() {
                let fixture = Fixture::find($file);
                let store = connect_garage();

                let returned = run_blob_store_fixture(&store, &fixture).await;

                assert_eq!(returned, fixture.expected_returns());
            }
        )*};
    }

    crate::blob_store::fixtures::for_each_blob_store_fixture!(garage_tests);
}

mod pull_request_unreadable_payload {
    use std::path::Path;

    use serde_json::json;

    use super::{create_s2_log, read_variable};
    use crate::commands::{HostConfig, up};
    use crate::database::{Store, open_store, read_offset};
    use crate::fact_log::s2::S2Settings;
    use crate::fact_log::{AppendOutcome, FactLog};

    const BASIN: &str = "pull-request-unreadable-payload";
    const STREAM: &str = "facts.github.pull_request";

    #[tokio::test(flavor = "multi_thread")]
    async fn it_stores_no_row_for_a_pull_request_fact_whose_payload_does_not_parse_and_applies_the_next_fact()
     {
        let consumers =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../build/consumers/consumers.json");

        assert!(
            consumers.exists(),
            "build the consumers first: bun run test:e2e:prepare"
        );

        let unreadable = json!({
            "id": "webhook:github:delivery-1",
            "type": "github.pull_request.opened",
            "v": 1,
            "api": "github/2022-11-28",
            "entity": "github:pull_request:41",
            "at": "2026-10-01T09:00:00Z",
            "payload": {"action": "opened", "pull_request": {"id": 41, "number": "forty-one"}}
        });
        let readable = json!({
            "id": "webhook:github:delivery-2",
            "type": "github.pull_request.opened",
            "v": 1,
            "api": "github/2022-11-28",
            "entity": "github:pull_request:42",
            "at": "2026-10-01T09:05:00Z",
            "payload": {
                "action": "opened",
                "pull_request": {
                    "id": 42,
                    "number": 7,
                    "title": "Chart the outer channel",
                    "state": "open",
                    "draft": false,
                    "merged": false,
                    "merge_commit_sha": null,
                    "html_url": "https://github.example/acme/harbour/pull/7",
                    "user": {"id": 4401},
                    "base": {"repo": {"id": 902}},
                    "created_at": "2026-10-01T09:05:00Z",
                    "updated_at": "2026-10-01T09:05:00Z",
                    "closed_at": null,
                    "merged_at": null
                }
            }
        });
        let log = create_s2_log(BASIN, &[STREAM.to_owned()]).await;

        assert_eq!(
            log.append_batch(STREAM, &[unreadable.to_string(), readable.to_string()], 0)
                .await
                .expect("an append"),
            AppendOutcome::Acknowledged {
                first_offset: 0,
                count: 2,
            }
        );

        let directory = tempfile::tempdir().expect("a directory");
        let config = HostConfig {
            s2: S2Settings {
                endpoint: read_variable("PEPYS_S2_ENDPOINT"),
                access_token: read_variable("PEPYS_S2_ACCESS_TOKEN"),
                basin: BASIN.to_owned(),
            },
            store_dir: directory.path().join("store"),
            consumers,
        };

        up(&config, Some("github_pull_request"), None)
            .await
            .expect("an up");

        let store = open_store(
            &config
                .store_dir
                .join("github_pull_request/current/consumer.db"),
        )
        .await
        .expect("the store");

        assert_eq!(
            (
                read_texts(&store, "SELECT id FROM github_pull_request").await,
                read_texts(&store, "SELECT fact_id FROM applied_facts ORDER BY fact_id").await,
                read_offset(&store, STREAM).await.expect("an offset"),
            ),
            (
                vec!["github:pull_request:42".to_owned()],
                vec![
                    "webhook:github:delivery-1".to_owned(),
                    "webhook:github:delivery-2".to_owned()
                ],
                Some(1)
            )
        );
    }

    async fn read_texts(store: &Store, query: &str) -> Vec<String> {
        let mut rows = store.connection.query(query, ()).await.expect("a query");
        let mut texts = Vec::new();

        while let Some(row) = rows.next().await.expect("a row") {
            texts.push(row.get(0).expect("a text"));
        }

        texts
    }
}

/// The ledger journey of the Bun test store: its records and the rows and links it expects.
const JOURNEY: &str = include_str!("../../../packages/testing/src/ledger/ledger-journey.json");
const LEDGER_STREAM: &str = "facts.ledger.account";

fn read_consumers_file() -> std::path::PathBuf {
    let consumers = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../build/consumers/consumers.json");

    assert!(
        consumers.exists(),
        "build the consumers first: bun run test:e2e:prepare"
    );

    consumers
}

fn read_journey_bodies() -> Vec<String> {
    let journey: serde_json::Value = serde_json::from_str(JOURNEY).expect("the journey");

    journey["records"]
        .as_array()
        .expect("the records")
        .iter()
        .map(|record| record["body"].as_str().expect("a body").to_owned())
        .collect()
}

fn build_host_config(
    basin: &str,
    endpoint: String,
    store_dir: std::path::PathBuf,
) -> crate::commands::HostConfig {
    crate::commands::HostConfig {
        s2: S2Settings {
            endpoint,
            access_token: read_variable("PEPYS_S2_ACCESS_TOKEN"),
            basin: basin.to_owned(),
        },
        store_dir,
        consumers: read_consumers_file(),
    }
}

/// The rows and links of the current `ledger_account` file, as the journey file lists them.
async fn read_ledger_state(config: &crate::commands::HostConfig) -> serde_json::Value {
    read_consumer_state(config, "ledger_account").await
}

/// The rows and links of the current file of `consumer`, as a journey file lists them.
async fn read_consumer_state(
    config: &crate::commands::HostConfig,
    consumer: &str,
) -> serde_json::Value {
    use serde_json::{Value, json};

    use crate::consumer::read_build_manifest;
    use crate::database::open_store;
    use crate::rows::load_all_rows;
    use crate::test_utils::{read_link_rows, to_float_numbers};

    let manifest = read_build_manifest(&config.consumers)
        .expect("consumers.json")
        .consumers
        .into_iter()
        .find(|listed| listed.name == consumer)
        .expect("the consumer")
        .manifest;
    let store = open_store(&config.store_dir.join(consumer).join("current/consumer.db"))
        .await
        .expect("the store");
    let mut rows = serde_json::Map::new();

    for (table, info) in &manifest.tables {
        let stored = load_all_rows(&store.connection, table, info)
            .await
            .expect("the rows");

        rows.insert(
            table.clone(),
            Value::Array(stored.into_iter().map(Value::Object).collect()),
        );
    }

    to_float_numbers(json!({"rows": rows, "links": read_link_rows(&store).await}))
}

fn read_expected_ledger_state() -> serde_json::Value {
    let journey: serde_json::Value = serde_json::from_str(JOURNEY).expect("the journey");

    crate::test_utils::to_float_numbers(
        serde_json::json!({"rows": journey["rows"], "links": journey["links"]}),
    )
}

async fn read_stored_offset(config: &crate::commands::HostConfig, stream: &str) -> Option<u64> {
    let store =
        crate::database::open_store(&config.store_dir.join("ledger_account/current/consumer.db"))
            .await
            .expect("the store");

    crate::database::read_offset(&store, stream)
        .await
        .expect("an offset")
}

mod scope_journey {
    use super::{LEDGER_STREAM, build_host_config, create_s2_log, read_variable};
    use crate::commands::up;
    use crate::fact_log::{AppendOutcome, FactLog};

    const BASIN: &str = "scope-ledger-journey";

    // The ledger module that `bun run consumers:build` compiled from the stub deployment, through
    // the host's `up` on s2-lite. A Bun test pins the journey file to the test store, so the host
    // and the test store give the same rows and links for the same facts.
    #[tokio::test(flavor = "multi_thread")]
    async fn it_stores_the_rows_and_links_of_the_ledger_journey_that_the_test_store_gives() {
        let bodies = super::read_journey_bodies();
        let log = create_s2_log(BASIN, &[LEDGER_STREAM.to_owned()]).await;

        assert_eq!(
            log.append_batch(LEDGER_STREAM, &bodies, 0)
                .await
                .expect("an append"),
            AppendOutcome::Acknowledged {
                first_offset: 0,
                count: bodies.len() as u64,
            }
        );

        let directory = tempfile::tempdir().expect("a directory");
        let config = build_host_config(
            BASIN,
            read_variable("PEPYS_S2_ENDPOINT"),
            directory.path().join("store"),
        );

        up(&config, Some("ledger_account"), None)
            .await
            .expect("an up");

        assert_eq!(
            super::read_ledger_state(&config).await,
            super::read_expected_ledger_state()
        );
    }
}

mod two_stream_scope {
    use std::path::{Path, PathBuf};

    use serde_json::Value;

    use super::{
        LEDGER_STREAM, build_host_config, create_s2_log, read_expected_ledger_state,
        read_journey_bodies, read_ledger_state, read_stored_offset, read_variable,
    };
    use crate::commands::up;
    use crate::fact_log::FactLog;

    const BASIN: &str = "scope-two-streams";
    const ENTRY_STREAM: &str = "facts.ledger.entry";

    /// A copy of the build's `consumers.json` in `directory` that lists both streams as the input
    /// of the ledger consumer, with a copy of its module. The compiled module reads its facts
    /// through the host, so it runs the same on two streams as on one.
    fn write_two_stream_consumers(directory: &Path) -> PathBuf {
        let source = super::read_consumers_file();
        let mut file: Value =
            serde_json::from_str(&std::fs::read_to_string(&source).expect("consumers.json"))
                .expect("a consumers file");
        let listed = file["consumers"]
            .as_array_mut()
            .expect("the consumers")
            .iter_mut()
            .find(|listed| listed["name"] == "ledger_account")
            .expect("the ledger consumer");
        let module = listed["path"].as_str().expect("a path").to_owned();

        listed["manifest"]["input"]["streams"] = serde_json::json!([LEDGER_STREAM, ENTRY_STREAM]);

        let copy = directory.join(&module);

        std::fs::create_dir_all(copy.parent().expect("a folder")).expect("a module folder");
        std::fs::copy(source.parent().expect("a folder").join(&module), copy).expect("a module");

        let written = directory.join("consumers.json");

        std::fs::write(&written, file.to_string()).expect("a consumers file");

        written
    }

    // The journey's entries go on a second stream and the rest stays on the first. The compiled
    // module reads facts in any order, so this test checks the rows of the two streams against the
    // test store's rows, and each stream's own offset; the order of the merge is in a unit test of
    // the host.
    #[tokio::test(flavor = "multi_thread")]
    async fn it_gives_a_compiled_scope_that_reads_two_streams_the_rows_that_the_test_store_gives() {
        let (entries, others): (Vec<String>, Vec<String>) =
            read_journey_bodies().into_iter().partition(|body| {
                serde_json::from_str::<Value>(body).expect("a body")["type"]
                    == "ledger.entry.posted"
            });
        let log = create_s2_log(BASIN, &[LEDGER_STREAM.to_owned(), ENTRY_STREAM.to_owned()]).await;

        log.append_batch(LEDGER_STREAM, &others, 0)
            .await
            .expect("the account facts");
        log.append_batch(ENTRY_STREAM, &entries, 0)
            .await
            .expect("the entry facts");

        let directory = tempfile::tempdir().expect("a directory");
        let mut config = build_host_config(
            BASIN,
            read_variable("PEPYS_S2_ENDPOINT"),
            directory.path().join("store"),
        );

        config.consumers = write_two_stream_consumers(&directory.path().join("build"));

        up(&config, Some("ledger_account"), None)
            .await
            .expect("an up");

        assert_eq!(
            read_ledger_state(&config).await,
            read_expected_ledger_state()
        );
        assert_eq!(
            (
                read_stored_offset(&config, LEDGER_STREAM).await,
                read_stored_offset(&config, ENTRY_STREAM).await
            ),
            (
                Some(others.len() as u64 - 1),
                Some(entries.len() as u64 - 1)
            )
        );
    }
}

/// The dock journey of the Bun test store, whose berth scope reads two streams.
mod dock_journey {
    use super::{build_host_config, create_s2_log, read_consumer_state, read_variable};
    use crate::commands::up;
    use crate::fact_log::{AppendOutcome, FactLog};

    const JOURNEY: &str = include_str!("../../../packages/testing/src/dock/dock-journey.json");
    const BASIN: &str = "scope-dock-journey";
    const ARRIVAL_STREAM: &str = "facts.dock.arrival";
    const LOAD_STREAM: &str = "facts.dock.load";

    fn read_stream_bodies(journey: &serde_json::Value, stream: &str) -> Vec<String> {
        journey["records"]
            .as_array()
            .expect("the records")
            .iter()
            .filter(|record| record["stream"] == stream)
            .map(|record| record["body"].as_str().expect("a body").to_owned())
            .collect()
    }

    // The compiled dock module reads one berth's facts from two streams, and its row names the
    // facts in the order the host handed them over. A Bun test pins the journey file to the test
    // store, so a host that reads one stream, or merges the two in another order, gives other rows.
    #[tokio::test(flavor = "multi_thread")]
    async fn it_stores_the_rows_of_the_dock_journey_that_the_test_store_gives_for_two_streams() {
        let journey: serde_json::Value = serde_json::from_str(JOURNEY).expect("the journey");
        let arrivals = read_stream_bodies(&journey, ARRIVAL_STREAM);
        let loads = read_stream_bodies(&journey, LOAD_STREAM);
        let log = create_s2_log(BASIN, &[ARRIVAL_STREAM.to_owned(), LOAD_STREAM.to_owned()]).await;

        for (stream, bodies) in [(ARRIVAL_STREAM, &arrivals), (LOAD_STREAM, &loads)] {
            assert_eq!(
                log.append_batch(stream, bodies, 0)
                    .await
                    .expect("an append"),
                AppendOutcome::Acknowledged {
                    first_offset: 0,
                    count: bodies.len() as u64,
                }
            );
        }

        let directory = tempfile::tempdir().expect("a directory");
        let config = build_host_config(
            BASIN,
            read_variable("PEPYS_S2_ENDPOINT"),
            directory.path().join("store"),
        );

        up(&config, Some("dock_berth"), None).await.expect("an up");

        assert_eq!(
            read_consumer_state(&config, "dock_berth").await,
            crate::test_utils::to_float_numbers(
                serde_json::json!({"rows": journey["rows"], "links": journey["links"]})
            )
        );
    }
}

mod second_process {
    use std::process::{Child, Command, Stdio};
    use std::time::{Duration, Instant};

    use super::{
        LEDGER_STREAM, build_host_config, create_s2_log, read_expected_ledger_state,
        read_journey_bodies, read_ledger_state, read_variable,
    };
    use crate::fact_log::FactLog;
    use crate::lock::WriterLock;
    use crate::test_utils::{collect_stderr, wait_for};

    const BASIN: &str = "second-process-up";

    /// A host process that the test kills when it ends, whatever the outcome.
    struct HostProcess(Child);

    impl Drop for HostProcess {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    fn find_host_binary() -> std::path::PathBuf {
        let binary = std::env::current_exe()
            .expect("this binary")
            .parent()
            .and_then(std::path::Path::parent)
            .expect("the target folder")
            .join("pepys");

        assert!(
            binary.exists(),
            "build the host first: bun run test:e2e:prepare"
        );

        binary
    }

    // The writer lock is an OS file lock, so a second process meets it as a second holder would. The
    // test holds the lock of the consumer's folder, and the `pepys up` process that it starts has
    // to wait: it deploys nothing until the test lets go, then it deploys the journey.
    #[tokio::test(flavor = "multi_thread")]
    async fn it_makes_the_up_of_a_second_process_wait_for_the_writer_lock() {
        // Under the 15 s slow-timeout of nextest's e2e profile, so a failure prints its message.
        let deadline = Instant::now() + Duration::from_secs(12);
        let bodies = read_journey_bodies();
        let log = create_s2_log(BASIN, &[LEDGER_STREAM.to_owned()]).await;

        log.append_batch(LEDGER_STREAM, &bodies, 0)
            .await
            .expect("an append");

        let directory = tempfile::tempdir().expect("a directory");
        let config = build_host_config(
            BASIN,
            read_variable("PEPYS_S2_ENDPOINT"),
            directory.path().join("store"),
        );
        let held = WriterLock::acquire(&config.store_dir.join("ledger_account"), Duration::ZERO)
            .await
            .expect("the lock");
        let mut host = HostProcess(
            Command::new(find_host_binary())
                .args(["up", "ledger_account"])
                .env("PEPYS_S2_ENDPOINT", &config.s2.endpoint)
                .env("PEPYS_S2_ACCESS_TOKEN", &config.s2.access_token)
                .env("PEPYS_S2_BASIN", BASIN)
                .env("PEPYS_STORE_DIR", &config.store_dir)
                .env("PEPYS_CONSUMERS", &config.consumers)
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .spawn()
                .expect("a host process"),
        );

        // A process that waits for the lock says so, after it read the whole log.
        let said = collect_stderr(&mut host.0);

        wait_for(
            "the second process never waited for the lock",
            deadline,
            async || {
                said.lock()
                    .expect("the lines")
                    .iter()
                    .any(|line| line.contains("waiting for the writer lock"))
                    .then_some(())
            },
        )
        .await;

        assert!(
            host.0.try_wait().expect("the host's state").is_none(),
            "the second process ended while this one held the writer lock"
        );
        assert!(
            config
                .store_dir
                .join("ledger_account/current")
                .symlink_metadata()
                .is_err(),
            "the second process swapped a version in while this one held the writer lock"
        );

        drop(held);

        let status = wait_for(
            "the second process never took the lock",
            deadline,
            async || host.0.try_wait().expect("the host's state"),
        )
        .await;

        assert!(status.success());
        assert_eq!(
            read_ledger_state(&config).await,
            read_expected_ledger_state()
        );
    }
}

mod s2_crash {
    use std::sync::atomic::{AtomicU8, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};
    use tokio::task::JoinHandle;

    use super::{
        LEDGER_STREAM, build_host_config, create_s2_log, read_expected_ledger_state,
        read_journey_bodies, read_ledger_state, read_stored_offset, read_variable,
    };
    use crate::commands::{HostConfig, run_task, up};
    use crate::database::open_store;
    use crate::error::HostError;
    use crate::fact_log::s2::S2Log;
    use crate::fact_log::{AppendOutcome, FactLog, RejectReason, StoredFact};
    use crate::test_utils::wait_for;

    const OPEN: u8 = 0;
    const RESET: u8 = 1;
    const SILENCE: u8 = 2;

    /// A TCP relay in front of s2-lite that can crash it, as the host sees a crash: from the
    /// moment of the crash, the host's connections end at s2-lite's next answer, or s2-lite still
    /// gets each request and none of its answers comes back. `restart` ends every connection and
    /// lets new ones through again.
    struct CrashingS2 {
        endpoint: String,
        address: std::net::SocketAddr,
        upstream: String,
        crash: Arc<AtomicU8>,
        relay: Mutex<Option<JoinHandle<()>>>,
    }

    impl CrashingS2 {
        async fn start(upstream: &str) -> Self {
            let upstream = url::Url::parse(upstream).expect("the endpoint");
            let upstream = format!(
                "{}:{}",
                upstream.host_str().expect("a host"),
                upstream.port().expect("a port")
            );
            let listener = TcpListener::bind("127.0.0.1:0").await.expect("a port");
            let address = listener.local_addr().expect("an address");
            let proxy = Self {
                endpoint: format!("http://{address}"),
                address,
                upstream,
                crash: Arc::new(AtomicU8::new(OPEN)),
                relay: Mutex::new(None),
            };

            proxy.relay_on(listener);

            proxy
        }

        fn relay_on(&self, listener: TcpListener) {
            let upstream = self.upstream.clone();
            let crash = Arc::clone(&self.crash);
            let relay = tokio::spawn(async move {
                let mut connections = tokio::task::JoinSet::new();

                loop {
                    let Ok((client, _)) = listener.accept().await else {
                        return;
                    };

                    connections.spawn(relay_connection(
                        client,
                        upstream.clone(),
                        Arc::clone(&crash),
                    ));
                }
            });

            *self.relay.lock().expect("the relay") = Some(relay);
        }

        /// Starts a crash that ends each connection at s2-lite's next answer.
        fn crash_by_reset(&self) {
            self.crash.store(RESET, Ordering::SeqCst);
        }

        /// Starts a crash after which s2-lite gets each request and no answer comes back.
        fn crash_by_silence(&self) {
            self.crash.store(SILENCE, Ordering::SeqCst);
        }

        /// Ends the crash. The relay goes down, which drops every open connection, and comes back.
        async fn restart(&self) {
            let relay = self.relay.lock().expect("the relay").take();

            if let Some(relay) = relay {
                relay.abort();
                let _ = relay.await;
            }

            self.crash.store(OPEN, Ordering::SeqCst);

            self.relay_on(
                TcpListener::bind(self.address)
                    .await
                    .expect("the port again"),
            );
        }
    }

    impl Drop for CrashingS2 {
        fn drop(&mut self) {
            if let Some(relay) = self.relay.lock().expect("the relay").take() {
                relay.abort();
            }
        }
    }

    async fn relay_connection(mut client: TcpStream, upstream: String, crash: Arc<AtomicU8>) {
        let Ok(mut server) = TcpStream::connect(upstream).await else {
            return;
        };
        let (mut client_read, mut client_write) = client.split();
        let (mut server_read, mut server_write) = server.split();
        let request = async {
            let mut buffer = [0_u8; 16384];

            loop {
                match client_read.read(&mut buffer).await {
                    Ok(0) | Err(_) => return,
                    Ok(count) => {
                        if server_write.write_all(&buffer[..count]).await.is_err() {
                            return;
                        }
                    }
                }
            }
        };
        let answer = async {
            let mut buffer = [0_u8; 16384];

            loop {
                match server_read.read(&mut buffer).await {
                    Ok(0) | Err(_) => return,
                    Ok(count) => {
                        match crash.load(Ordering::SeqCst) {
                            RESET => return,
                            SILENCE => continue,
                            _ => {}
                        }

                        if client_write.write_all(&buffer[..count]).await.is_err() {
                            return;
                        }
                    }
                }
            }
        };

        tokio::select! { () = request => {}, () = answer => {} }
    }

    /// A log that gives the reads of the host to `S2Log` and keeps each one, as the sequence number
    /// it starts at and the count it asks for.
    struct RecordingLog {
        inner: S2Log,
        reads: Arc<Mutex<Vec<(u64, usize)>>>,
    }

    impl FactLog for RecordingLog {
        async fn append_batch(
            &self,
            stream: &str,
            bodies: &[String],
            expected_tail: u64,
        ) -> Result<AppendOutcome, HostError> {
            self.inner.append_batch(stream, bodies, expected_tail).await
        }

        async fn read(
            &self,
            stream: &str,
            from: u64,
            count: usize,
        ) -> Result<Vec<StoredFact>, HostError> {
            self.reads.lock().expect("the reads").push((from, count));

            self.inner.read(stream, from, count).await
        }

        async fn read_tail(&self, stream: &str) -> Result<u64, HostError> {
            self.inner.read_tail(stream).await
        }
    }

    /// The task of the ledger consumer, with the failures that it reports and the reads that it
    /// makes.
    struct RunningTask {
        handle: JoinHandle<Result<(), HostError>>,
        failures: Arc<Mutex<Vec<String>>>,
        reads: Arc<Mutex<Vec<(u64, usize)>>>,
    }

    /// Runs the task of the ledger consumer on `config` until the test aborts it.
    fn spawn_task(config: &HostConfig) -> RunningTask {
        let failures = Arc::new(Mutex::new(Vec::new()));
        let reads = Arc::new(Mutex::new(Vec::new()));
        let task = tokio::spawn({
            let (config, failures, reads) =
                (config.clone(), Arc::clone(&failures), Arc::clone(&reads));

            async move {
                let log = RecordingLog {
                    inner: S2Log::connect(&config.s2).expect("a log"),
                    reads,
                };

                run_task(&config, &log, "ledger_account", |error, _| {
                    failures
                        .lock()
                        .expect("the failures")
                        .push(error.to_string());
                })
                .await
            }
        });

        RunningTask {
            handle: task,
            failures,
            reads,
        }
    }

    async fn read_change_log_batches(config: &HostConfig) -> i64 {
        let store = open_store(&config.store_dir.join("ledger_account/current/consumer.db"))
            .await
            .expect("the store");
        let mut rows = store
            .connection
            .query("SELECT count(*) FROM change_log", ())
            .await
            .expect("a query");

        rows.next()
            .await
            .expect("a row")
            .expect("a count")
            .get(0)
            .expect("a number")
    }

    // s2-lite dies while the host's task reads, after the task committed a batch beyond the offset
    // of its first pass: the task reports the failure and stays alive. A host that is killed then
    // resumes at the offset of the committed batch, reads only what follows it, and each fact is
    // applied once.
    #[tokio::test(flavor = "multi_thread")]
    async fn it_resumes_from_the_committed_offset_after_s2_lite_crashes_during_a_read() {
        const BASIN: &str = "s2-crash-during-read";

        // Under the 15 s slow-timeout of nextest's e2e profile, so a failure prints its message.
        let deadline = Instant::now() + Duration::from_secs(12);
        let bodies = read_journey_bodies();
        let direct = create_s2_log(BASIN, &[LEDGER_STREAM.to_owned()]).await;
        let s2 = CrashingS2::start(&read_variable("PEPYS_S2_ENDPOINT")).await;
        let directory = tempfile::tempdir().expect("a directory");
        let config = build_host_config(BASIN, s2.endpoint.clone(), directory.path().join("store"));

        direct
            .append_batch(LEDGER_STREAM, &bodies[..3], 0)
            .await
            .expect("the first facts");
        up(&config, Some("ledger_account"), None)
            .await
            .expect("an up");

        assert_eq!(read_stored_offset(&config, LEDGER_STREAM).await, Some(2));

        let task = spawn_task(&config);

        direct
            .append_batch(LEDGER_STREAM, &bodies[3..5], 3)
            .await
            .expect("the second batch");

        wait_for(
            "the task never applied the second batch",
            deadline,
            async || (read_stored_offset(&config, LEDGER_STREAM).await == Some(4)).then_some(()),
        )
        .await;

        s2.crash_by_reset();
        direct
            .append_batch(LEDGER_STREAM, &bodies[5..], 5)
            .await
            .expect("the third batch");

        wait_for("the task never reported the crash", deadline, async || {
            (!task.failures.lock().expect("the failures").is_empty()).then_some(())
        })
        .await;

        assert!(
            !task.handle.is_finished(),
            "the task ended instead of retrying"
        );

        // The host is killed while its task waits to retry.
        task.handle.abort();
        let _ = task.handle.await;

        assert_eq!(read_stored_offset(&config, LEDGER_STREAM).await, Some(4));

        s2.restart().await;

        let restarted = spawn_task(&config);
        let last = bodies.len() as u64 - 1;

        wait_for("the restarted task never caught up", deadline, async || {
            (read_stored_offset(&config, LEDGER_STREAM).await == Some(last)).then_some(())
        })
        .await;
        restarted.handle.abort();
        let _ = restarted.handle.await;

        // One read, of exactly the facts after the committed batch.
        assert_eq!(
            *restarted.reads.lock().expect("the reads"),
            vec![(5, bodies.len() - 5)]
        );
        // One batch for each of the three passes that applied facts.
        assert_eq!(read_change_log_batches(&config).await, 3);
        assert_eq!(
            read_ledger_state(&config).await,
            read_expected_ledger_state()
        );
    }

    // s2-lite dies after it stored an append and before it answered: the writer learns nothing, and
    // the stream holds the batch once. The writer reads the tail, finds the batch, and appends only
    // what is missing, so no fact is lost or doubled.
    #[tokio::test(flavor = "multi_thread")]
    async fn it_stores_an_append_once_when_s2_lite_crashes_before_it_answers() {
        const BASIN: &str = "s2-crash-during-append";

        let bodies = read_journey_bodies();
        let direct = create_s2_log(BASIN, &[LEDGER_STREAM.to_owned()]).await;
        let s2 = CrashingS2::start(&read_variable("PEPYS_S2_ENDPOINT")).await;
        let directory = tempfile::tempdir().expect("a directory");
        let config = build_host_config(BASIN, s2.endpoint.clone(), directory.path().join("store"));
        let through_crash = S2Log::connect(&config.s2).expect("a log");

        direct
            .append_batch(LEDGER_STREAM, &bodies[..3], 0)
            .await
            .expect("the first facts");
        s2.crash_by_silence();

        // No answer comes back before the client's request timeout, so the writer cannot tell
        // whether s2-lite stored the batch.
        assert_eq!(
            through_crash
                .append_batch(LEDGER_STREAM, &bodies[3..], 3)
                .await
                .expect("an outcome"),
            AppendOutcome::Unknown
        );

        s2.restart().await;

        // The request reached s2-lite before the crash, so the batch is on the stream already.
        let tail = through_crash
            .read_tail(LEDGER_STREAM)
            .await
            .expect("a tail");

        assert_eq!(tail, bodies.len() as u64);

        // The writer's retry names the tail it saw, so s2-lite refuses it as a second copy.
        assert_eq!(
            through_crash
                .append_batch(LEDGER_STREAM, &bodies[3..], 3)
                .await
                .expect("an outcome"),
            AppendOutcome::Rejected(RejectReason::TailMismatch)
        );

        let stored = through_crash
            .read(LEDGER_STREAM, 0, bodies.len() + 5)
            .await
            .expect("a read");

        assert_eq!(
            stored.into_iter().map(|fact| fact.body).collect::<Vec<_>>(),
            bodies
        );

        up(&config, Some("ledger_account"), None)
            .await
            .expect("an up");

        assert_eq!(
            read_ledger_state(&config).await,
            read_expected_ledger_state()
        );
    }
}
