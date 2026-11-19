//! A throughput bench, off in every lane. It seeds one stream of one consumer on a basin of its own,
//! and times one `up` of the consumer, the replay of the whole stream. Run it on a release build
//! with `bun scripts/e2e/run-with-stack.ts cargo test --release -p pepys-host throughput --
//! --ignored --nocapture`, and set these variables:
//!
//! - `PEPYS_BENCH_CONSUMERS`, the `consumers.json` to read;
//! - `PEPYS_BENCH_CONSUMER`, `logbook_voyage` (fact mode) or `ledger_account` (scope mode);
//! - `PEPYS_BENCH_FACTS`, how many facts to append;
//! - `PEPYS_BENCH_ENTITIES`, how many entities the facts spread over, round robin. In scope mode an
//!   entity is a scope;
//! - `PEPYS_BENCH_SEED_ONLY`, when set, seeds the stream and prints the basin without an `up`, so
//!   the `pepys` binary can run it.

#![allow(clippy::print_stdout)]

use std::time::Instant;

use super::{create_s2_log, read_variable};
use crate::commands::{HostConfig, up};
use crate::fact_log::s2::S2Settings;
use crate::fact_log::{AppendOutcome, FactLog};

const APPEND_SIZE: usize = 1000;

fn read_number(name: &str) -> usize {
    read_variable(name)
        .parse()
        .unwrap_or_else(|_| panic!("{name} is a number"))
}

/// The stream of the consumer in the consumers file.
fn read_stream(consumers: &std::path::Path, consumer: &str) -> String {
    let file: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(consumers).expect("consumers.json"))
            .expect("JSON");

    file["consumers"]
        .as_array()
        .expect("the consumers")
        .iter()
        .find(|listed| listed["name"] == consumer)
        .expect("the consumer")["manifest"]["input"]["streams"][0]
        .as_str()
        .expect("a stream")
        .to_owned()
}

/// One second of a made-up timeline that starts on 2026-11-01, as an RFC 3339 time.
fn format_time(index: usize) -> String {
    let day = 1 + index / 86_400;
    let second = index % 86_400;

    format!(
        "2026-11-{day:02}T{:02}:{:02}:{:02}Z",
        second / 3600,
        second / 60 % 60,
        second % 60
    )
}

/// The body of fact `index`. In scope mode the first fact of an entity opens its account, and each
/// later one posts an entry.
fn build_body(consumer: &str, index: usize, entities: usize) -> String {
    let entity = index % entities;
    let at = format_time(index);

    if consumer == "ledger_account" {
        let (kind, payload) = if index < entities {
            (
                "ledger.account.opened",
                format!(r#"{{"name":"Account {entity}"}}"#),
            )
        } else {
            (
                "ledger.entry.posted",
                format!(
                    r#"{{"entry":"e-{index}","amount":{},"rate":1.5,"memo":"Entry {index}","details":{{"till":"north"}}}}"#,
                    index % 90 + 1
                ),
            )
        };

        return format!(
            r#"{{"id":"event:ledger:bench-{index}","type":"{kind}","v":1,"api":"ledger/1","entity":"ledger:account:a{entity}","at":"{at}","payload":{payload}}}"#
        );
    }

    format!(
        r#"{{"id":"event:logbook:bench-{index}","type":"logbook.voyage.logged","v":1,"api":"logbook/1","entity":"logbook:voyage:v{entity}","at":"{at}","payload":{{"title":"Voyage {index}","harbour":"Harbour {}"}}}}"#,
        index % 50
    )
}

async fn seed(
    log: &impl FactLog,
    stream: &str,
    consumer: &str,
    facts: usize,
    entities: usize,
) -> std::time::Duration {
    let started = Instant::now();

    for first in (0..facts).step_by(APPEND_SIZE) {
        let bodies: Vec<String> = (first..facts.min(first + APPEND_SIZE))
            .map(|index| build_body(consumer, index, entities))
            .collect();

        assert_eq!(
            log.append_batch(stream, &bodies, first as u64)
                .await
                .expect("an append"),
            AppendOutcome::Acknowledged {
                first_offset: first as u64,
                count: bodies.len() as u64,
            }
        );
    }

    started.elapsed()
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "a bench: it measures and asserts nothing about the host's answers"]
async fn it_times_an_up_of_a_stream_of_the_size_the_variables_give() {
    let consumers = std::path::PathBuf::from(read_variable("PEPYS_BENCH_CONSUMERS"));
    let consumer = read_variable("PEPYS_BENCH_CONSUMER");
    let facts = read_number("PEPYS_BENCH_FACTS");
    let entities = read_number("PEPYS_BENCH_ENTITIES");
    let stream = read_stream(&consumers, &consumer);
    let basin = format!(
        "bench-{}-{}",
        consumer.replace('_', "-"),
        std::process::id()
    );
    let log = create_s2_log(&basin, std::slice::from_ref(&stream)).await;
    let seeded = seed(&log, &stream, &consumer, facts, entities).await;

    println!("basin {basin}: seeded {facts} facts in {seeded:?}");

    if std::env::var("PEPYS_BENCH_SEED_ONLY").is_ok() {
        return;
    }

    let directory = tempfile::tempdir().expect("a directory");
    let config = HostConfig {
        s2: S2Settings {
            endpoint: read_variable("PEPYS_S2_ENDPOINT"),
            access_token: read_variable("PEPYS_S2_ACCESS_TOKEN"),
            basin,
        },
        store_dir: directory.path().join("store"),
        consumers,
    };
    let started = Instant::now();

    up(&config, Some(&consumer), None).await.expect("an up");

    let elapsed = started.elapsed();

    println!(
        "{consumer}: {facts} facts over {entities} entities, up in {elapsed:?}, {:.0} facts/s",
        f64::from(u32::try_from(facts).expect("a count under 2^32")) / elapsed.as_secs_f64()
    );
}
