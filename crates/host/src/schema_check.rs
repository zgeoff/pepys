//! The check at open: `consumers.json` describes each table twice, as columns and as SQL, and the
//! host holds the file that the SQL made to the columns before it reads one fact.

use std::collections::BTreeSet;

use turso::Value;

use crate::consumer::{ColumnKind, ConsumerManifest, TableInfo};
use crate::database::Store;
use crate::error::HostError;

/// The tables the host makes in a consumer file, which the manifest does not list.
const HOST_TABLES: [&str; 5] = [
    "offsets",
    "change_log",
    "applied_facts",
    "scope_row",
    "link",
];

/// One column as `PRAGMA table_info` gives it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredColumn {
    pub name: String,
    pub declared_type: String,
    pub not_null: bool,
    /// The column's place in the primary key, from 1, or 0 outside it.
    pub key_position: i64,
}

/// Compares the file's tables with the manifest's: the same tables, each with the same columns,
/// each column of the declared type its kind gives, NOT NULL where it is not nullable, and the
/// primary key's columns in order.
///
/// # Errors
/// Fails with [`HostError::SchemaMismatch`] at the first difference, or when a query fails.
pub async fn check_schema(store: &Store, manifest: &ConsumerManifest) -> Result<(), HostError> {
    let stored = read_table_names(store).await?;
    let listed: BTreeSet<String> = manifest.tables.keys().cloned().collect();

    if let Some(table) = stored.symmetric_difference(&listed).next() {
        return Err(HostError::SchemaMismatch {
            table: table.clone(),
            reason: if listed.contains(table) {
                "the file has no such table".to_owned()
            } else {
                "the manifest lists no such table".to_owned()
            },
        });
    }

    for (table, info) in &manifest.tables {
        let columns = read_table_columns(store, table).await?;

        check_columns(info, &columns).map_err(|reason| HostError::SchemaMismatch {
            table: table.clone(),
            reason,
        })?;
    }

    Ok(())
}

/// The first difference between a table of the manifest and its columns in the file.
///
/// # Errors
/// Fails with the reason for the difference.
pub fn check_columns(info: &TableInfo, columns: &[StoredColumn]) -> Result<(), String> {
    let stored: BTreeSet<&str> = columns.iter().map(|column| column.name.as_str()).collect();
    let listed: BTreeSet<&str> = info.columns.keys().map(String::as_str).collect();

    if let Some(name) = stored.symmetric_difference(&listed).next() {
        return Err(format!("the column {name} is in only one of the two"));
    }

    for column in columns {
        let Some(declared) = info.columns.get(&column.name) else {
            continue;
        };
        let expected = to_declared_type(declared.kind);

        if !column.declared_type.eq_ignore_ascii_case(expected) {
            return Err(format!(
                "the column {} is {}, and its kind needs {expected}",
                column.name, column.declared_type
            ));
        }

        if column.not_null == declared.nullable {
            return Err(format!(
                "the column {} differs in NOT NULL from its nullable flag",
                column.name
            ));
        }
    }

    let mut key: Vec<&StoredColumn> = columns
        .iter()
        .filter(|column| column.key_position > 0)
        .collect();

    key.sort_by_key(|column| column.key_position);

    if key
        .iter()
        .map(|column| column.name.as_str())
        .ne(info.primary_key.iter().map(String::as_str))
    {
        return Err("the primary key differs".to_owned());
    }

    Ok(())
}

fn to_declared_type(kind: ColumnKind) -> &'static str {
    match kind {
        ColumnKind::Text | ColumnKind::EntityId | ColumnKind::Timestamp | ColumnKind::Json => {
            "TEXT"
        }
        ColumnKind::Integer | ColumnKind::Boolean => "INTEGER",
        ColumnKind::Real => "REAL",
    }
}

async fn read_table_names(store: &Store) -> Result<BTreeSet<String>, HostError> {
    let mut rows = store
        .connection
        .query(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'",
            (),
        )
        .await?;
    let mut names = BTreeSet::new();

    while let Some(row) = rows.next().await? {
        let name: String = row.get(0)?;

        if !HOST_TABLES.contains(&name.as_str()) {
            names.insert(name);
        }
    }

    Ok(names)
}

/// The columns of `table`, as `PRAGMA table_info` gives them.
///
/// # Errors
/// Fails when the query fails.
pub async fn read_table_columns(
    store: &Store,
    table: &str,
) -> Result<Vec<StoredColumn>, HostError> {
    let mut rows = store
        .connection
        .query(
            "SELECT name, type, \"notnull\", pk FROM pragma_table_info(?1)",
            vec![Value::from(table)],
        )
        .await?;
    let mut columns = Vec::new();

    while let Some(row) = rows.next().await? {
        columns.push(StoredColumn {
            name: row.get(0)?,
            declared_type: row.get(1)?,
            not_null: row.get::<i64>(2)? != 0,
            key_position: row.get(3)?,
        });
    }

    Ok(columns)
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;
    use crate::database::open_store;
    use crate::test_utils::stub_manifest;

    async fn setup(sql: &str) -> (tempfile::TempDir, Store) {
        let directory = tempfile::tempdir().expect("a directory");
        let store = open_store(&directory.path().join("consumer.db"))
            .await
            .expect("a store");

        store.connection.execute_batch(sql).await.expect("the SQL");

        (directory, store)
    }

    #[tokio::test]
    async fn it_reads_the_declared_type_the_not_null_flag_and_the_key_order_from_turso() {
        let (_directory, store) = setup(
            "CREATE TABLE ledger_entry (day INTEGER NOT NULL, id TEXT NOT NULL, amount REAL, \
             PRIMARY KEY (id, day))",
        )
        .await;

        let columns = read_table_columns(&store, "ledger_entry")
            .await
            .expect("the columns");

        assert_eq!(
            columns,
            vec![
                StoredColumn {
                    name: "day".to_owned(),
                    declared_type: "INTEGER".to_owned(),
                    not_null: true,
                    key_position: 2,
                },
                StoredColumn {
                    name: "id".to_owned(),
                    declared_type: "TEXT".to_owned(),
                    not_null: true,
                    key_position: 1,
                },
                StoredColumn {
                    name: "amount".to_owned(),
                    declared_type: "REAL".to_owned(),
                    not_null: false,
                    key_position: 0,
                },
            ]
        );
    }

    #[tokio::test]
    async fn it_accepts_the_file_that_the_manifests_own_sql_makes() {
        let manifest = stub_manifest();
        let (_directory, store) = setup(&manifest.schema).await;

        assert!(check_schema(&store, &manifest).await.is_ok());
    }

    #[tokio::test]
    async fn it_refuses_a_column_whose_sql_differs_from_its_nullable_flag() {
        let manifest = stub_manifest();
        let (_directory, store) = setup(
            &manifest
                .schema
                .replace("\"title\" TEXT NOT NULL", "\"title\" TEXT"),
        )
        .await;

        assert_eq!(
            check_schema(&store, &manifest)
                .await
                .map_err(|error| error.to_string()),
            Err("the file does not match the manifest's table github_pull_request: the column title differs in NOT NULL from its nullable flag".to_owned())
        );
    }

    #[tokio::test]
    async fn it_refuses_a_file_with_a_table_the_manifest_does_not_list() {
        let manifest = stub_manifest();
        let (_directory, store) = setup(&format!(
            "{}\nCREATE TABLE stray (id TEXT);",
            manifest.schema
        ))
        .await;

        assert!(matches!(
            check_schema(&store, &manifest).await,
            Err(HostError::SchemaMismatch { table, .. }) if table == "stray"
        ));
    }

    fn info() -> TableInfo {
        serde_json::from_value(serde_json::json!({
            "columns": {
                "id": {"kind": "entityID", "nullable": false},
                "day": {"kind": "integer", "nullable": false},
            },
            "primaryKey": ["id", "day"],
            "indexes": [],
        }))
        .expect("a table")
    }

    fn column(name: &str, declared_type: &str, key_position: i64) -> StoredColumn {
        StoredColumn {
            name: name.to_owned(),
            declared_type: declared_type.to_owned(),
            not_null: true,
            key_position,
        }
    }

    #[test]
    fn it_refuses_a_primary_key_in_another_order() {
        assert_eq!(
            check_columns(
                &info(),
                &[column("id", "TEXT", 2), column("day", "INTEGER", 1)]
            ),
            Err("the primary key differs".to_owned())
        );
    }

    #[test]
    fn it_refuses_a_declared_type_that_the_kind_does_not_give() {
        assert_eq!(
            check_columns(
                &info(),
                &[column("id", "TEXT", 1), column("day", "REAL", 2)]
            ),
            Err("the column day is REAL, and its kind needs INTEGER".to_owned())
        );
    }
}
