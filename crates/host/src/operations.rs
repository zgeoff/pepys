//! The wire between a module and the host: one JSON list of operations, each with one verb. The
//! parse turns the wire into domain values once, checked against the manifest's tables.

use serde_json::Value;

use crate::consumer::{ConsumerManifest, TableInfo};
use crate::error::HostError;
use crate::links::{Link, LinkEnds};
use crate::rows::{Row, check_row, key_of, key_of_key_row};

#[derive(Debug, Clone, PartialEq)]
pub enum Operation {
    /// A whole row of one of the consumer's tables, checked against its columns.
    Upsert {
        table: String,
        key: String,
        row: Row,
    },
    /// The key of a row of one of the consumer's tables, as [`key_of`] gives it.
    Delete {
        table: String,
        key: String,
    },
    Link(Link),
    Unlink(LinkEnds),
}

/// Parses a module's output.
///
/// # Errors
/// Fails with [`HostError::BadOperation`] for output that is no list of one-verb operations,
/// [`HostError::NotOwned`] for a table the manifest does not declare, and [`HostError::BadRow`]
/// for a row that does not fit its table.
pub fn parse_operations(
    manifest: &ConsumerManifest,
    output: &str,
) -> Result<Vec<Operation>, HostError> {
    let Ok(Value::Array(items)) = serde_json::from_str::<Value>(output) else {
        return Err(HostError::BadOperation(
            "the output is not a JSON list".to_owned(),
        ));
    };

    items
        .into_iter()
        .map(|item| parse_operation(manifest, item))
        .collect()
}

fn parse_operation(manifest: &ConsumerManifest, item: Value) -> Result<Operation, HostError> {
    let Value::Object(verbs) = item else {
        return Err(HostError::BadOperation(format!("{item} is not an object")));
    };
    let mut verbs = verbs.into_iter();
    let (Some((verb, body)), None) = (verbs.next(), verbs.next()) else {
        return Err(HostError::BadOperation(
            "an operation has exactly one verb".to_owned(),
        ));
    };

    match verb.as_str() {
        "upsert" => {
            let (table, info, row) = parse_table_body(manifest, body)?;

            check_row(&table, info, &row)?;

            Ok(Operation::Upsert {
                key: key_of(&table, info, &row)?,
                table,
                row,
            })
        }
        "delete" => {
            let (table, info, row) = parse_table_body(manifest, body)?;

            Ok(Operation::Delete {
                key: key_of_key_row(&table, info, &row)?,
                table,
            })
        }
        "link" => Ok(Operation::Link(parse_body(&verb, body)?)),
        "unlink" => Ok(Operation::Unlink(parse_body(&verb, body)?)),
        _ => Err(HostError::BadOperation(format!("an unknown verb {verb}"))),
    }
}

fn parse_body<T: serde::de::DeserializeOwned>(verb: &str, body: Value) -> Result<T, HostError> {
    serde_json::from_value(body)
        .map_err(|error| HostError::BadOperation(format!("{verb}: {error}")))
}

// One table name, one row.
fn parse_table_body(
    manifest: &ConsumerManifest,
    body: Value,
) -> Result<(String, &TableInfo, Row), HostError> {
    let Value::Object(tables) = body else {
        return Err(HostError::BadOperation(format!(
            "{body} is not an object of one table"
        )));
    };
    let mut tables = tables.into_iter();
    let (Some((table, Value::Object(row))), None) = (tables.next(), tables.next()) else {
        return Err(HostError::BadOperation(
            "an operation names exactly one table, with one row".to_owned(),
        ));
    };
    let info = manifest
        .tables
        .get(&table)
        .ok_or_else(|| HostError::NotOwned {
            table: table.clone(),
        })?;

    Ok((table, info, row))
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::test_utils::{stub_manifest, upsert_json};

    #[test]
    fn it_parses_an_upsert_with_the_key_of_its_row() {
        let manifest = stub_manifest();

        let operations =
            parse_operations(&manifest, &upsert_json("github:pull_request:1", "First"))
                .expect("operations");

        assert!(matches!(
            operations.as_slice(),
            [Operation::Upsert { table, key, .. }]
                if table == "github_pull_request" && key == r#"["github:pull_request:1"]"#
        ));
    }

    #[test]
    fn it_parses_a_delete_that_holds_its_key_as_a_row() {
        let output = json!([{"delete": {"github_pull_request": {"id": "github:pull_request:1"}}}]);

        assert_eq!(
            parse_operations(&stub_manifest(), &output.to_string()).expect("operations"),
            vec![Operation::Delete {
                table: "github_pull_request".to_owned(),
                key: r#"["github:pull_request:1"]"#.to_owned(),
            }]
        );
    }

    #[test]
    fn it_parses_a_flat_link_and_reads_none_of_its_fields_as_a_table() {
        let output = json!([{"link": {
            "type": "produced", "from": "boxxy:attempt:1", "to": "github:pull_request:1",
            "confidence": 1, "evidence": "event:boxxy:1"
        }}]);

        assert_eq!(
            parse_operations(&stub_manifest(), &output.to_string()).expect("operations"),
            vec![Operation::Link(Link {
                link_type: "produced".to_owned(),
                from: "boxxy:attempt:1".to_owned(),
                to: "github:pull_request:1".to_owned(),
                confidence: 1.0,
                evidence: "event:boxxy:1".to_owned(),
            })]
        );
    }

    #[test]
    fn it_refuses_an_operation_with_two_verbs() {
        let output = json!([{"upsert": {}, "delete": {}}]);

        assert!(matches!(
            parse_operations(&stub_manifest(), &output.to_string()),
            Err(HostError::BadOperation(_))
        ));
    }

    #[test]
    fn it_refuses_output_that_is_no_json_list() {
        assert!(matches!(
            parse_operations(&stub_manifest(), "{"),
            Err(HostError::BadOperation(_))
        ));
    }

    #[test]
    fn it_refuses_an_upsert_to_a_table_the_manifest_does_not_declare() {
        let output = json!([{"upsert": {"someone_elses_table": {"id": "x"}}}]);

        assert_eq!(
            parse_operations(&stub_manifest(), &output.to_string())
                .map_err(|error| error.to_string()),
            Err(
                "the consumer returned an operation on someone_elses_table, which it does not own"
                    .to_owned()
            )
        );
    }

    #[test]
    fn it_refuses_an_upsert_whose_row_does_not_fit_its_table() {
        let output = json!([{"upsert": {"github_pull_request": {"id": "github:pull_request:1"}}}]);

        assert!(matches!(
            parse_operations(&stub_manifest(), &output.to_string()),
            Err(HostError::BadRow { .. })
        ));
    }
}
