//! A row as a JSON object, with its table and columns taken from the manifest: the check of a
//! row, its key, and its load, write and delete.

use serde_json::{Map, Number, Value};
use turso::Connection;

use crate::consumer::{ColumnInfo, ColumnKind, TableInfo};
use crate::error::HostError;

pub type Row = Map<String, Value>;

fn bad_row(table: &str, reason: String) -> HostError {
    HostError::BadRow {
        table: table.to_owned(),
        reason,
    }
}

/// Every column present, no other key, each value of the column's kind, null only where nullable.
///
/// # Errors
/// Fails with the first column that breaks a rule.
pub fn check_row(table: &str, info: &TableInfo, row: &Row) -> Result<(), HostError> {
    if let Some(key) = row.keys().find(|key| !info.columns.contains_key(*key)) {
        return Err(bad_row(table, format!("{key} is not a column")));
    }

    for (name, column) in &info.columns {
        let value = row
            .get(name)
            .ok_or_else(|| bad_row(table, format!("the column {name} is absent")))?;

        if !fits(*column, value) {
            return Err(bad_row(table, format!("the column {name} holds {value}")));
        }
    }

    Ok(())
}

// An integer column refuses a number written with a fraction or an exponent, even `5.0`: serde
// reads such a number as a float.
fn fits(column: ColumnInfo, value: &Value) -> bool {
    match (value, column.kind) {
        (Value::Null, _) => column.nullable,
        (Value::String(_), ColumnKind::Text | ColumnKind::EntityId | ColumnKind::Timestamp)
        | (Value::Bool(_), ColumnKind::Boolean)
        | (Value::Number(_), ColumnKind::Real)
        | (_, ColumnKind::Json) => true,
        (Value::Number(number), ColumnKind::Integer) => number.is_i64(),
        (
            Value::String(_)
            | Value::Bool(_)
            | Value::Number(_)
            | Value::Array(_)
            | Value::Object(_),
            ColumnKind::Text
            | ColumnKind::EntityId
            | ColumnKind::Timestamp
            | ColumnKind::Boolean
            | ColumnKind::Real
            | ColumnKind::Integer,
        ) => false,
    }
}

/// The primary key as text: the JSON list of the key's values, in primary key order. One form for
/// a key of one column and of several. The change log holds it.
///
/// # Errors
/// Fails when the row lacks a key column.
pub fn key_of(table: &str, info: &TableInfo, row: &Row) -> Result<String, HostError> {
    let values = info
        .primary_key
        .iter()
        .map(|column| {
            row.get(column)
                .cloned()
                .ok_or_else(|| bad_row(table, format!("the key column {column} is absent")))
        })
        .collect::<Result<Vec<Value>, HostError>>()?;

    Ok(Value::Array(values).to_string())
}

/// The key of a delete operation, which holds the key's columns as a row and no other column.
///
/// # Errors
/// Fails when the row holds another column, or a key column is absent or of the wrong kind.
pub fn key_of_key_row(table: &str, info: &TableInfo, row: &Row) -> Result<String, HostError> {
    if let Some(key) = row.keys().find(|key| !info.primary_key.contains(*key)) {
        return Err(bad_row(table, format!("{key} is not a key column")));
    }

    for name in &info.primary_key {
        let column = column_of(table, info, name)?;

        if let Some(value) = row.get(name)
            && !fits(column, value)
        {
            return Err(bad_row(table, format!("the column {name} holds {value}")));
        }
    }

    key_of(table, info, row)
}

/// The key of the module's row read. For a key of one column, the module passes the column's value
/// as text; for a key of several, the JSON list of the values in key order.
///
/// # Errors
/// Fails when the argument is no key of the table.
pub fn key_of_read(table: &str, info: &TableInfo, argument: &str) -> Result<String, HostError> {
    let [name] = info.primary_key.as_slice() else {
        let values: Vec<Value> = serde_json::from_str(argument)
            .map_err(|_| bad_row(table, format!("{argument} is no JSON list of key values")))?;

        return Ok(Value::Array(values).to_string());
    };
    let value = match column_of(table, info, name)?.kind {
        ColumnKind::Integer => Value::Number(
            argument
                .parse::<i64>()
                .map_err(|_| bad_row(table, format!("{argument} is no integer key")))?
                .into(),
        ),
        ColumnKind::Text
        | ColumnKind::EntityId
        | ColumnKind::Timestamp
        | ColumnKind::Real
        | ColumnKind::Boolean
        | ColumnKind::Json => Value::String(argument.to_owned()),
    };

    Ok(Value::Array(vec![value]).to_string())
}

/// Whether two rows hold the same values, with REAL columns compared as floats so that the wire's
/// `2` equals the stored `2.0`, and JSON columns compared as values.
#[must_use]
pub fn is_same_row(info: &TableInfo, left: &Row, right: &Row) -> bool {
    info.columns.iter().all(
        |(name, column)| match (column.kind, left.get(name), right.get(name)) {
            (ColumnKind::Real, Some(Value::Number(a)), Some(Value::Number(b))) => {
                a.as_f64() == b.as_f64()
            }
            (_, a, b) => a == b,
        },
    )
}

fn column_of(table: &str, info: &TableInfo, name: &str) -> Result<ColumnInfo, HostError> {
    info.columns
        .get(name)
        .copied()
        .ok_or_else(|| bad_row(table, format!("no column {name}")))
}

fn quote(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn to_sql(table: &str, kind: ColumnKind, value: &Value) -> Result<turso::Value, HostError> {
    Ok(match (value, kind) {
        (Value::Null, _) => turso::Value::Null,
        (_, ColumnKind::Json) => turso::Value::from(serde_json::to_string(value)?),
        (Value::String(text), _) => turso::Value::from(text.as_str()),
        (Value::Bool(flag), _) => turso::Value::from(i64::from(*flag)),
        (Value::Number(number), ColumnKind::Real) => turso::Value::from(
            number
                .as_f64()
                .ok_or_else(|| bad_row(table, format!("{number} is no float")))?,
        ),
        (Value::Number(number), _) => turso::Value::from(
            number
                .as_i64()
                .ok_or_else(|| bad_row(table, format!("{number} is no integer")))?,
        ),
        (Value::Array(_) | Value::Object(_), _) => {
            return Err(bad_row(table, format!("{value} in a plain column")));
        }
    })
}

fn from_sql(table: &str, kind: ColumnKind, value: turso::Value) -> Result<Value, HostError> {
    Ok(match (value, kind) {
        (turso::Value::Null, _) => Value::Null,
        (turso::Value::Text(text), ColumnKind::Json) => serde_json::from_str(&text)?,
        (turso::Value::Text(text), _) => Value::String(text),
        (turso::Value::Integer(number), ColumnKind::Boolean) => Value::Bool(number != 0),
        (turso::Value::Integer(number), _) => Value::Number(number.into()),
        (turso::Value::Real(number), _) => {
            Number::from_f64(number).map_or(Value::Null, Value::Number)
        }
        (turso::Value::Blob(_), _) => {
            return Err(bad_row(table, "a blob in a row".to_owned()));
        }
    })
}

fn key_values(table: &str, info: &TableInfo, key: &str) -> Result<Vec<turso::Value>, HostError> {
    let values: Vec<Value> =
        serde_json::from_str(key).map_err(|_| bad_row(table, format!("{key} is not a key")))?;

    if values.len() != info.primary_key.len() {
        return Err(bad_row(table, format!("{key} is not a key")));
    }

    info.primary_key
        .iter()
        .zip(values.iter())
        .map(|(name, value)| to_sql(table, column_of(table, info, name)?.kind, value))
        .collect()
}

fn key_filter(info: &TableInfo) -> String {
    info.primary_key
        .iter()
        .zip(1..)
        .map(|(column, index): (&String, usize)| format!("{} = ?{index}", quote(column)))
        .collect::<Vec<String>>()
        .join(" AND ")
}

fn column_list(info: &TableInfo) -> String {
    info.columns
        .keys()
        .map(|name| quote(name))
        .collect::<Vec<String>>()
        .join(", ")
}

fn read_stored(table: &str, info: &TableInfo, stored: &turso::Row) -> Result<Row, HostError> {
    let mut row = Row::new();

    for (index, (name, column)) in info.columns.iter().enumerate() {
        row.insert(
            name.clone(),
            from_sql(table, column.kind, stored.get_value(index)?)?,
        );
    }

    Ok(row)
}

/// Loads the row whose key is `key`, the text that [`key_of`] gives.
///
/// # Errors
/// Fails when the key does not fit the table, or the query or a conversion fails.
pub async fn load_row(
    connection: &Connection,
    table: &str,
    info: &TableInfo,
    key: &str,
) -> Result<Option<Row>, HostError> {
    let mut rows = connection
        .query(
            &format!(
                "SELECT {} FROM {} WHERE {}",
                column_list(info),
                quote(table),
                key_filter(info)
            ),
            key_values(table, info, key)?,
        )
        .await?;

    let Some(stored) = rows.next().await? else {
        return Ok(None);
    };

    Ok(Some(read_stored(table, info, &stored)?))
}

/// Every row of the table, in primary key order.
///
/// # Errors
/// Fails when the query or a conversion fails.
pub async fn load_all_rows(
    connection: &Connection,
    table: &str,
    info: &TableInfo,
) -> Result<Vec<Row>, HostError> {
    let order = info
        .primary_key
        .iter()
        .map(|name| quote(name))
        .collect::<Vec<String>>()
        .join(", ");
    let mut rows = connection
        .query(
            &format!(
                "SELECT {} FROM {} ORDER BY {order}",
                column_list(info),
                quote(table)
            ),
            (),
        )
        .await?;
    let mut result = Vec::new();

    while let Some(stored) = rows.next().await? {
        result.push(read_stored(table, info, &stored)?);
    }

    Ok(result)
}

/// Writes `row`, replacing the row with the same key. The caller has checked the row.
///
/// # Errors
/// Fails when a value does not fit its column or the statement fails.
pub async fn write_row(
    connection: &Connection,
    table: &str,
    info: &TableInfo,
    row: &Row,
) -> Result<(), HostError> {
    let mut marks = Vec::new();
    let mut values = Vec::new();

    for (index, (name, column)) in info.columns.iter().enumerate() {
        marks.push(format!("?{}", index + 1));
        values.push(to_sql(
            table,
            column.kind,
            row.get(name).unwrap_or(&Value::Null),
        )?);
    }

    connection
        .execute(
            &format!(
                "INSERT OR REPLACE INTO {} ({}) VALUES ({})",
                quote(table),
                column_list(info),
                marks.join(", ")
            ),
            values,
        )
        .await?;

    Ok(())
}

/// Deletes the row whose key is `key`.
///
/// # Errors
/// Fails when the key does not fit the table or the statement fails.
pub async fn delete_row(
    connection: &Connection,
    table: &str,
    info: &TableInfo,
    key: &str,
) -> Result<(), HostError> {
    connection
        .execute(
            &format!("DELETE FROM {} WHERE {}", quote(table), key_filter(info)),
            key_values(table, info, key)?,
        )
        .await?;

    Ok(())
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::database::open_store;

    fn ledger() -> TableInfo {
        serde_json::from_value(json!({
            "columns": {
                "id": {"kind": "entityID", "nullable": false},
                "day": {"kind": "integer", "nullable": false},
                "amount": {"kind": "real", "nullable": false},
                "is_open": {"kind": "boolean", "nullable": false},
                "note": {"kind": "text", "nullable": true},
                "extra": {"kind": "json", "nullable": false},
            },
            "primaryKey": ["id", "day"],
            "indexes": [],
        }))
        .expect("a table")
    }

    fn row(value: Value) -> Row {
        let Value::Object(row) = value else {
            panic!("a row is an object");
        };

        row
    }

    fn entry() -> Row {
        row(json!({
            "id": "ledger:entry:1", "day": 3, "amount": 2, "is_open": true, "note": null,
            "extra": {"b": [1], "a": "x"}
        }))
    }

    #[test]
    fn it_accepts_a_row_with_every_column_of_its_kind() {
        assert!(check_row("ledger_entry", &ledger(), &entry()).is_ok());
    }

    #[test]
    fn it_refuses_an_integer_written_with_a_fraction() {
        let mut fractional = entry();

        fractional.insert("day".to_owned(), json!(3.0));

        assert_eq!(
            check_row("ledger_entry", &ledger(), &fractional).map_err(|error| error.to_string()),
            Err("the consumer returned a row of ledger_entry the host refuses: the column day holds 3.0".to_owned())
        );
    }

    #[test]
    fn it_refuses_a_row_with_a_column_left_out() {
        let mut short = entry();

        short.remove("note");

        assert!(matches!(
            check_row("ledger_entry", &ledger(), &short),
            Err(HostError::BadRow { .. })
        ));
    }

    #[test]
    fn it_refuses_a_row_with_an_unknown_column() {
        let mut long = entry();

        long.insert("colour".to_owned(), json!("red"));

        assert!(matches!(
            check_row("ledger_entry", &ledger(), &long),
            Err(HostError::BadRow { .. })
        ));
    }

    #[test]
    fn it_refuses_a_null_in_a_column_that_is_not_nullable() {
        let mut empty = entry();

        empty.insert("amount".to_owned(), Value::Null);

        assert!(matches!(
            check_row("ledger_entry", &ledger(), &empty),
            Err(HostError::BadRow { .. })
        ));
    }

    #[test]
    fn it_gives_the_key_as_the_json_list_of_its_values_in_key_order() {
        assert_eq!(
            key_of("ledger_entry", &ledger(), &entry()).expect("a key"),
            r#"["ledger:entry:1",3]"#
        );
    }

    #[test]
    fn it_names_the_table_when_a_key_column_is_absent() {
        assert_eq!(
            key_of("ledger_entry", &ledger(), &row(json!({"id": "x"})))
                .map_err(|error| error.to_string()),
            Err("the consumer returned a row of ledger_entry the host refuses: the key column day is absent".to_owned())
        );
    }

    #[test]
    fn it_reads_a_delete_key_held_as_a_row() {
        assert_eq!(
            key_of_key_row(
                "ledger_entry",
                &ledger(),
                &row(json!({"day": 3, "id": "ledger:entry:1"}))
            )
            .expect("a key"),
            r#"["ledger:entry:1",3]"#
        );
    }

    #[test]
    fn it_refuses_a_delete_key_with_a_column_outside_the_key() {
        assert!(matches!(
            key_of_key_row(
                "ledger_entry",
                &ledger(),
                &row(json!({"day": 3, "id": "ledger:entry:1", "note": "x"}))
            ),
            Err(HostError::BadRow { .. })
        ));
    }

    #[test]
    fn it_reads_the_bare_value_of_a_one_column_key_from_a_row_read() {
        let mut info = ledger();

        info.primary_key = vec!["day".to_owned()];

        assert_eq!(
            key_of_read("ledger_entry", &info, "3").expect("a key"),
            "[3]"
        );
    }

    #[test]
    fn it_reads_the_json_list_of_a_key_of_several_columns_from_a_row_read() {
        assert_eq!(
            key_of_read("ledger_entry", &ledger(), r#"["ledger:entry:1", 3]"#).expect("a key"),
            r#"["ledger:entry:1",3]"#
        );
    }

    #[test]
    fn it_finds_a_real_column_written_as_an_integer_the_same_as_the_stored_float() {
        let mut stored = entry();

        stored.insert("amount".to_owned(), json!(2.0));

        assert!(is_same_row(&ledger(), &entry(), &stored));
    }

    #[tokio::test]
    async fn it_loads_the_row_it_wrote_with_each_kind_restored() {
        let directory = tempfile::tempdir().expect("a directory");
        let store = open_store(&directory.path().join("rows.db"))
            .await
            .expect("a store");

        store
            .connection
            .execute_batch(
                "CREATE TABLE ledger_entry (id TEXT NOT NULL, day INTEGER NOT NULL, \
                 amount REAL NOT NULL, is_open INTEGER NOT NULL, note TEXT, extra TEXT NOT NULL, \
                 PRIMARY KEY (id, day))",
            )
            .await
            .expect("a table");
        write_row(&store.connection, "ledger_entry", &ledger(), &entry())
            .await
            .expect("a written row");

        let loaded = load_row(
            &store.connection,
            "ledger_entry",
            &ledger(),
            r#"["ledger:entry:1",3]"#,
        )
        .await
        .expect("a load");

        assert_eq!(
            loaded.map(Value::Object),
            Some(json!({
                "id": "ledger:entry:1", "day": 3, "amount": 2.0, "is_open": true, "note": null,
                "extra": {"a": "x", "b": [1]}
            }))
        );
    }
}
