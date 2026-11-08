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
