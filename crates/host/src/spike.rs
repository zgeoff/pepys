//! SPIKE. Runs the real `boxxy_work` module of spikes/scriptc-real through this host: the real
//! runner, the fact index, `check_link`, `replace_scope` and a store opened as batch.rs opens one.
//! `SPIKE_REAL` is the scriptc-real folder; `SPIKE_HOME` holds the manifest and takes `out/`.

#![allow(clippy::expect_used, clippy::unwrap_used, clippy::too_many_lines)]

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{Value, json};

use crate::database::{Store, open_store, prepare_scope_store, read_offset};
use crate::error::HostError;
use crate::fact_index::{FactIndex, open_index};
use crate::fact_log::memory::MemoryLog;
use crate::fact_log::{FactLog, StoredFact};
use crate::manifest::ConsumerManifest;
use crate::module_runner::ScopeModuleRunner;
use crate::rows::load_all_rows;
use crate::scope::{FactSource, ScopeRunner, apply_scope_batch};

const SCOPE: &str = "boxxy:item:0193a1b2-0000-7000-8000-000000000001";
const STREAM: &str = "facts.boxxy.work";
const NAMES: [&str; 9] = [
    "main",
    "main-tie",
    "large-id",
    "late-1",
    "late-2",
    "settle",
    "settle-tie",
    "nested",
    "sixty",
];

fn folder(variable: &str) -> PathBuf {
    PathBuf::from(std::env::var(variable).unwrap_or_else(|_| panic!("{variable} is set")))
}

fn manifest() -> Arc<ConsumerManifest> {
    let text = std::fs::read_to_string(folder("SPIKE_HOME").join("boxxy-work-manifest.json"))
        .expect("the manifest");

    Arc::new(serde_json::from_str(&text).expect("a manifest the host's types accept"))
}

fn module(manifest: &Arc<ConsumerManifest>) -> ScopeModuleRunner {
    let name = std::env::var("SPIKE_MODULE").unwrap_or_else(|_| "v2".to_owned());
    let bytes =
        std::fs::read(folder("SPIKE_REAL").join(format!("out/{name}.wasm"))).expect("the module");

    ScopeModuleRunner::new(&bytes, Arc::clone(manifest)).expect("a valid module")
}

/// The facts of a fact file, each as the text of its own JSON.
fn facts_of(name: &str) -> Vec<String> {
    let text = std::fs::read_to_string(folder("SPIKE_REAL").join(format!("facts/{name}.json")))
        .expect("a fact file");
    let Value::Array(facts) = serde_json::from_str::<Value>(&text).expect("json") else {
        panic!("{name} is not a list");
    };

    facts.iter().map(Value::to_string).collect()
}

struct World {
    _directory: tempfile::TempDir,
    store: Store,
    index: FactIndex,
    manifest: Arc<ConsumerManifest>,
}

async fn setup() -> World {
    let directory = tempfile::tempdir().expect("a temporary directory");
    let manifest = manifest();
    let store = open_store(&directory.path().join("consumer.db"))
        .await
        .expect("a store");

    prepare_scope_store(&store, &manifest.schema)
        .await
        .expect("the schema and the host's tables");

    let index = open_index(&directory.path().join("index.db"))
        .await
        .expect("an index");

    World {
        _directory: directory,
        store,
        index,
        manifest,
    }
}

async fn apply(
    world: &World,
    runner: &mut dyn ScopeRunner,
    log: &MemoryLog,
    from: u64,
    count: usize,
) -> Result<(), HostError> {
    let facts: Vec<StoredFact> = log.read(STREAM, from, count).await.expect("records");

    apply_scope_batch(
        &world.store,
        &world.manifest,
        runner,
        &world.index,
        log,
        STREAM,
        &facts,
    )
    .await
}

async fn query(store: &Store, sql: &str) -> Vec<Vec<turso::Value>> {
    let mut rows = store.connection.query(sql, ()).await.expect("a query");
    let mut result = Vec::new();

    while let Some(row) = rows.next().await.expect("a row") {
        result.push(
            (0..row.column_count())
                .map(|index| row.get_value(index).expect("a value"))
                .collect(),
        );
    }

    result
}

async fn count(store: &Store, table: &str) -> i64 {
    *query(store, &format!("SELECT count(*) FROM {table}")).await[0][0]
        .as_integer()
        .expect("a count")
}

/// What the store holds: every row of every table, and every link, as the earlier spike keyed them.
async fn dump(world: &World) -> Value {
    let mut result = serde_json::Map::new();

    for (table, info) in &world.manifest.tables {
        let rows = load_all_rows(&world.store.connection, table, info)
            .await
            .expect("rows");

        result.insert(
            table.clone(),
            Value::Array(rows.into_iter().map(Value::Object).collect()),
        );
    }

    let text = |value: &turso::Value| value.as_text().cloned();
    let links = query(&world.store, "SELECT type, from_id, to_id, confidence, evidence, scope, origin FROM link ORDER BY type, from_id, to_id").await;

    result.insert(
        "links".to_owned(),
        links.iter().map(|link| json!({"type": text(&link[0]), "from": text(&link[1]), "to": text(&link[2]), "confidence": link[3].as_real(), "evidence": text(&link[4])})).collect(),
    );
    result.insert(
        "link_owners".to_owned(),
        links
            .iter()
            .map(|link| json!([text(&link[5]), text(&link[6])]))
            .collect(),
    );
    result.insert(
        "scope_row".to_owned(),
        query(&world.store, "SELECT table_name, scope, count(*) FROM scope_row GROUP BY table_name, scope ORDER BY 1, 2")
            .await
            .iter()
            .map(|row| json!([text(&row[0]), text(&row[1]), row[2].as_integer()]))
            .collect(),
    );
    result.insert(
        "entity_view_rows".to_owned(),
        json!(count(&world.store, "entity").await),
    );

    Value::Object(result)
}

fn write_out(name: &str, value: &Value) {
    let path = folder("SPIKE_HOME").join("out").join(name);

    std::fs::write(path, serde_json::to_string_pretty(value).expect("json"))
        .expect("a written file");
}

struct FileFacts(Vec<u8>);

impl FactSource for FileFacts {
    fn read_scope_facts(&self, _scope: &str) -> Result<Vec<u8>, HostError> {
        Ok(self.0.clone())
    }
}

// Probe 1: the real runner alone, fed the fact file as the earlier harness fed it.
#[tokio::test(flavor = "multi_thread")]
async fn p1_the_real_runner_gives_the_output_of_the_earlier_harness_byte_for_byte() {
    let manifest = manifest();
    let mut runner = module(&manifest);

    for name in NAMES {
        let facts = std::fs::read(folder("SPIKE_REAL").join(format!("facts/{name}.json")))
            .expect("a fact file");
        let output = runner
            .apply_scope(SCOPE, Arc::new(FileFacts(facts)))
            .expect("the module runs");
        let expected =
            std::fs::read_to_string(folder("SPIKE_REAL").join(format!("results/{name}.wasm.json")))
                .expect("a result");

        println!(
            "p1 {name}: {} bytes, equal to results/{name}.wasm.json: {}",
            output.len(),
            output == expected.trim_end()
        );
        assert_eq!(output, expected.trim_end(), "{name}");
    }
}

// The 9 fact files, each in a new store, as one batch through index, module, checks and store.
#[tokio::test(flavor = "multi_thread")]
async fn p2_each_fact_file_as_one_batch_into_a_store() {
    for name in NAMES {
        let world = setup().await;
        let mut runner = module(&world.manifest);
        let bodies = facts_of(name);
        let log = MemoryLog::seeded(
            STREAM,
            &bodies.iter().map(String::as_str).collect::<Vec<&str>>(),
        );

        apply(&world, &mut runner, &log, 0, 100)
            .await
            .unwrap_or_else(|error| panic!("{name}: {error}"));

        let state = dump(&world).await;

        println!(
            "p2 {name}: {} facts, offset {:?}, change_log rows {}, links {}, scope_row {}",
            bodies.len(),
            read_offset(&world.store, STREAM).await.expect("an offset"),
            count(&world.store, "change_log").await,
            count(&world.store, "link").await,
            count(&world.store, "scope_row").await
        );
        write_out(&format!("{name}.store.json"), &state);
    }
}

// `main` one fact per batch: replace_scope updates and inserts 20 times. Then a copy of a fact.
#[tokio::test(flavor = "multi_thread")]
async fn p3_one_fact_per_batch_then_the_same_fact_again() {
    let world = setup().await;
    let mut runner = module(&world.manifest);
    let mut bodies = facts_of("main");

    bodies.push(bodies[5].clone());

    let log = MemoryLog::seeded(
        STREAM,
        &bodies.iter().map(String::as_str).collect::<Vec<&str>>(),
    );
    let mut sizes = Vec::new();

    for offset in 0..20 {
        apply(&world, &mut runner, &log, offset, 1)
            .await
            .unwrap_or_else(|error| panic!("fact {offset}: {error}"));
    }

    for row in query(
        &world.store,
        "SELECT batch, changes FROM change_log ORDER BY batch",
    )
    .await
    {
        let changes: Value = serde_json::from_str(row[1].as_text().expect("text")).expect("json");
        let kinds: Vec<String> = changes
            .as_array()
            .expect("a list")
            .iter()
            .map(|change| {
                format!(
                    "{}:{}",
                    change["type"].as_str().unwrap(),
                    change["headers"]["operation"].as_str().unwrap()
                )
            })
            .collect();

        sizes.push(format!("{}={}", row[0].as_integer().unwrap(), kinds.len()));

        if *row[0].as_integer().unwrap() == 6 {
            println!("p3 changes of batch 6: {}", kinds.join(" "));
        }
    }

    println!("p3 change entries per batch: {}", sizes.join(" "));
    write_out("main.stepwise.store.json", &dump(&world).await);

    let before = (count(&world.store, "change_log").await, dump(&world).await);

    apply(&world, &mut runner, &log, 20, 1)
        .await
        .expect("the copy applies");

    let after = (count(&world.store, "change_log").await, dump(&world).await);

    println!(
        "p3 copy of fact 5 at offset 20: offset {:?}, change_log rows {} -> {}, index rows {}, store equal: {}",
        read_offset(&world.store, STREAM).await.expect("an offset"),
        before.0,
        after.0,
        *query(&world.index.store, "SELECT count(*) FROM fact").await[0][0]
            .as_integer()
            .unwrap(),
        before.1 == after.1
    );
    assert_eq!(
        (
            read_offset(&world.store, STREAM).await.expect("an offset"),
            before.0,
            &before.1
        ),
        (Some(20), after.0, &after.1)
    );
}

// The claim arrives after the start (late-2 with its two facts in the other log order).
#[tokio::test(flavor = "multi_thread")]
async fn p4_a_fact_that_arrives_late() {
    let world = setup().await;
    let mut runner = module(&world.manifest);
    let bodies = facts_of("late-2");
    let log = MemoryLog::seeded(STREAM, &[bodies[1].as_str(), bodies[0].as_str()]);

    apply(&world, &mut runner, &log, 0, 1)
        .await
        .expect("the start applies");

    let first = (
        count(&world.store, "boxxy_attempt").await,
        count(&world.store, "link").await,
        count(&world.store, "change_log").await,
    );

    apply(&world, &mut runner, &log, 1, 1)
        .await
        .expect("the claim applies");
    println!(
        "p4 after the start alone: attempts, links, change_log rows {first:?}; after the claim: {:?}",
        (
            count(&world.store, "boxxy_attempt").await,
            count(&world.store, "link").await,
            count(&world.store, "change_log").await
        )
    );
    write_out("late-2.late.store.json", &dump(&world).await);
}

/// Returns the listed outputs for a scope, one per call, then `[]`.
struct Canned(HashMap<String, Vec<String>>);

impl ScopeRunner for Canned {
    fn apply_scope(
        &mut self,
        scope: &str,
        _facts: Arc<dyn FactSource>,
    ) -> Result<String, HostError> {
        Ok(match self.0.get_mut(scope) {
            Some(outputs) if !outputs.is_empty() => outputs.remove(0),
            _ => "[]".to_owned(),
        })
    }
}

fn session(attempt: &str, session: &str) -> Value {
    json!({"upsert": {"boxxy_attempt_session": {"attempt_id": format!("boxxy:attempt:{attempt}"), "session_id": format!("telemetry:session:{session}"), "key": "atc", "product": null, "bound_at": "2026-11-11T02:00:00.000Z"}}})
}

fn link(link_type: &str, from: &str, to: &str, confidence: f64, evidence: &str) -> Value {
    json!({"link": {"type": link_type, "from": from, "to": to, "confidence": confidence, "evidence": evidence}})
}

fn tiny_fact(number: u32, item: &str) -> String {
    json!({"id": format!("event:boxxy:{number}"), "type": "boxxy.item.filed", "v": 1, "api": "boxxy/1", "entity": format!("boxxy:item:{item}"), "at": "2026-11-11T02:00:00.000Z", "payload": {}}).to_string()
}

// check_link and replace_scope on cases the 9 files do not hold, with a canned module.
#[tokio::test(flavor = "multi_thread")]
async fn p5_refusals_and_deletes() {
    let world = setup().await;
    let good = link(
        "ran_in",
        "boxxy:attempt:a",
        "telemetry:session:s",
        1.0,
        "event:boxxy:1",
    );
    let bodies = [
        tiny_fact(1, "one"),
        tiny_fact(2, "one"),
        tiny_fact(3, "two"),
        tiny_fact(4, "one"),
        tiny_fact(5, "one"),
        tiny_fact(6, "one"),
        tiny_fact(7, "one"),
    ];
    let log = MemoryLog::seeded(
        STREAM,
        &bodies.iter().map(String::as_str).collect::<Vec<&str>>(),
    );
    let mut runner = Canned(HashMap::from([
        (
            "boxxy:item:one".to_owned(),
            vec![
                json!([session("a", "s"), session("a", "t"), good]).to_string(),
                json!([session("a", "s")]).to_string(),
                json!([
                    session("a", "s"),
                    link(
                        "ran_in",
                        "boxxy:attempt:a",
                        "github:pull_request:9",
                        1.0,
                        "event:boxxy:1"
                    )
                ])
                .to_string(),
                json!([
                    session("a", "s"),
                    link(
                        "mentions",
                        "boxxy:attempt:a",
                        "telemetry:session:s",
                        1.0,
                        "event:boxxy:1"
                    )
                ])
                .to_string(),
                json!([
                    session("a", "s"),
                    link(
                        "ran_in",
                        "boxxy:attempt:a",
                        "telemetry:session:s",
                        1.5,
                        "event:boxxy:1"
                    )
                ])
                .to_string(),
                json!([
                    session("a", "s"),
                    link("ran_in", "boxxy:attempt:a", "telemetry:session:s", 1.0, "")
                ])
                .to_string(),
            ],
        ),
        (
            "boxxy:item:two".to_owned(),
            vec![json!([session("a", "s")]).to_string()],
        ),
    ]));
    let state = async |world: &World| {
        (
            count(&world.store, "boxxy_attempt_session").await,
            count(&world.store, "link").await,
            count(&world.store, "scope_row").await,
            read_offset(&world.store, STREAM).await.expect("an offset"),
        )
    };

    apply(&world, &mut runner, &log, 0, 1)
        .await
        .expect("the first result applies");
    println!(
        "p5 two rows and a link: rows, links, scope_row, offset {:?}",
        state(&world).await
    );
    apply(&world, &mut runner, &log, 1, 1)
        .await
        .expect("the second result applies");

    let changes = query(
        &world.store,
        "SELECT changes FROM change_log WHERE batch = 1",
    )
    .await;

    println!(
        "p5 the scope returns one row and no link: {:?}; changes {}",
        state(&world).await,
        changes[0][0].as_text().unwrap()
    );

    for (offset, what) in [
        (2, "a row that scope one owns, from scope two"),
        (3, "a link with a to end of a wrong kind"),
        (4, "a link of a type not declared"),
        (5, "a confidence of 1.5"),
        (6, "an empty evidence"),
    ] {
        let result = apply(&world, &mut runner, &log, offset, 1).await;

        println!(
            "p5 {what}: {:?}; state {:?}",
            result.map_err(|error| error.to_string()),
            state(&world).await
        );
    }

    assert_eq!(state(&world).await, (1, 0, 1, Some(1)));
}

// What the real log port says of a boxxy fact, and what today's parse says of the design's link.
#[tokio::test(flavor = "multi_thread")]
async fn p6_mismatches_with_today() {
    let log = MemoryLog::new(&[STREAM.to_owned()]);
    let outcome = log
        .append(STREAM, &facts_of("main")[0], 0)
        .await
        .expect("an outcome");

    println!("p6 MemoryLog.append of the first fact of main.json: {outcome:?}");

    let spec = crate::consumer::find_consumer("github_pull_request").expect("the consumer");
    let world = setup().await;
    let flat = link(
        "ran_in",
        "boxxy:attempt:a",
        "telemetry:session:s",
        1.0,
        "event:boxxy:1",
    );
    let mut canned = crate::test_utils::CannedRunner::new(&[("a", Ok(json!([flat]).to_string()))]);
    let result = crate::batch::apply_batch(
        &world.store,
        spec,
        &mut canned,
        &[StoredFact {
            offset: 0,
            body: "a".to_owned(),
            appended_at_ms: 0,
        }],
    )
    .await;

    println!(
        "p6 today's apply_batch on a flat link: {:?}",
        result.map_err(|error| error.to_string())
    );
}

// One batch with two dirty scopes: scope one's result is written, then scope two's link is
// refused. The transaction must take scope one's row back.
#[tokio::test(flavor = "multi_thread")]
async fn p7_a_refusal_in_the_second_scope_rolls_the_first_scope_back() {
    let world = setup().await;
    let bodies = [
        tiny_fact(1, "one"),
        tiny_fact(2, "one"),
        tiny_fact(3, "two"),
    ];
    let log = MemoryLog::seeded(
        STREAM,
        &bodies.iter().map(String::as_str).collect::<Vec<&str>>(),
    );
    let mut runner = Canned(HashMap::from([
        (
            "boxxy:item:one".to_owned(),
            vec![
                json!([session("a", "s")]).to_string(),
                json!([session("a", "s"), session("a", "t")]).to_string(),
            ],
        ),
        (
            "boxxy:item:two".to_owned(),
            vec![
                json!([link(
                    "ran_in",
                    "boxxy:attempt:b",
                    "github:pull_request:9",
                    1.0,
                    "event:boxxy:3"
                )])
                .to_string(),
            ],
        ),
    ]));
    let state = async |world: &World| {
        (
            count(&world.store, "boxxy_attempt_session").await,
            count(&world.store, "scope_row").await,
            count(&world.store, "change_log").await,
            read_offset(&world.store, STREAM).await.expect("an offset"),
        )
    };

    apply(&world, &mut runner, &log, 0, 1)
        .await
        .expect("the first batch applies");

    let before = state(&world).await;
    let result = apply(&world, &mut runner, &log, 1, 2).await;

    println!(
        "p7 before {before:?}; a batch of scopes one (a new row) and two (a bad link): {:?}; after {:?}",
        result.map_err(|error| error.to_string()),
        state(&world).await
    );
    assert_eq!(state(&world).await, before);
}

// The same batch as p2 `main` on the default (current-thread) test runtime.
#[tokio::test]
#[should_panic(expected = "can call blocking only when running on the multi-threaded runtime")]
async fn p8_the_index_read_panics_on_a_current_thread_runtime() {
    let world = setup().await;
    let mut runner = module(&world.manifest);
    let bodies = facts_of("main");
    let log = MemoryLog::seeded(
        STREAM,
        &bodies.iter().map(String::as_str).collect::<Vec<&str>>(),
    );

    let _ = apply(&world, &mut runner, &log, 0, 100).await;
}

#[test]
fn p9_a_wire_1_is_not_a_stored_1_0_as_json_values() {
    println!("p9 json 1 == json 1.0: {}", json!(1) == json!(1.0));
    assert_ne!(json!(1), json!(1.0));
}
