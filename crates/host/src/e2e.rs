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

    // The pull request module that `bun run consumers:build` compiled from the stub deployment,
    // through the host's `up` on s2-lite, on a fact whose payload holds no pull request it can read
    // and then on a readable one.
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

mod scope_journey {
    use std::path::Path;

    use serde_json::{Value, json};

    use super::{create_s2_log, read_variable};
    use crate::commands::{HostConfig, up};
    use crate::consumer::read_build_manifest;
    use crate::database::open_store;
    use crate::fact_log::s2::S2Settings;
    use crate::fact_log::{AppendOutcome, FactLog};
    use crate::rows::load_all_rows;
    use crate::test_utils::{read_link_rows, to_float_numbers};

    const JOURNEY: &str = include_str!("../../../packages/testing/src/ledger/ledger-journey.json");
    const BASIN: &str = "scope-ledger-journey";
    const STREAM: &str = "facts.ledger.account";

    // The ledger module that `bun run consumers:build` compiled from the stub deployment, through
    // the host's `up` on s2-lite. A Bun test pins the journey file to the test store, so the host
    // and the test store give the same rows and links for the same facts.
    #[tokio::test(flavor = "multi_thread")]
    async fn it_stores_the_rows_and_links_of_the_ledger_journey_that_the_test_store_gives() {
        let consumers =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../build/consumers/consumers.json");

        assert!(
            consumers.exists(),
            "build the consumers first: bun run test:e2e:prepare"
        );

        let journey: Value = serde_json::from_str(JOURNEY).expect("the journey");
        let bodies: Vec<String> = journey["records"]
            .as_array()
            .expect("the records")
            .iter()
            .map(|record| record["body"].as_str().expect("a body").to_owned())
            .collect();
        let log = create_s2_log(BASIN, &[STREAM.to_owned()]).await;

        assert_eq!(
            log.append_batch(STREAM, &bodies, 0)
                .await
                .expect("an append"),
            AppendOutcome::Acknowledged {
                first_offset: 0,
                count: bodies.len() as u64,
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

        up(&config, Some("ledger_account"), None)
            .await
            .expect("an up");

        let manifest = read_build_manifest(&config.consumers)
            .expect("consumers.json")
            .consumers
            .into_iter()
            .find(|listed| listed.name == "ledger_account")
            .expect("the ledger consumer")
            .manifest;
        let store = open_store(&config.store_dir.join("ledger_account/current/consumer.db"))
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

        assert_eq!(
            to_float_numbers(json!({"rows": rows, "links": read_link_rows(&store).await})),
            to_float_numbers(json!({"rows": journey["rows"], "links": journey["links"]}))
        );
    }
}
