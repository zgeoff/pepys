//! SPIKE. Rows as JSON objects, with the table taken from the manifest (design part D, rows.rs).

use serde_json::{Map, Number, Value};
use turso::Connection;

use crate::error::HostError;
use crate::manifest::{ColumnKind, TableInfo};

pub type Row = Map<String, Value>;

fn bad(table: &str, reason: &str) -> HostError {
    HostError::BadOperation(format!("{table}: {reason}"))
}

/// Every column present, no other key, each value of the column's kind, null only where nullable.
///
/// # Errors
/// Fails with the first column that breaks a rule.
pub fn check_row(table: &str, info: &TableInfo, row: &Row) -> Result<(), HostError> {
    for key in row.keys() {
        if !info.columns.contains_key(key) {
            return Err(bad(table, &format!("{key} is not a column")));
        }
    }

    for (name, column) in &info.columns {
        let value = row
            .get(name)
            .ok_or_else(|| bad(table, &format!("column {name} is absent")))?;
        let fits = match (value, column.kind) {
            (Value::Null, _) => column.nullable,
            (Value::String(_), ColumnKind::Text | ColumnKind::EntityId | ColumnKind::Timestamp)
            | (Value::Bool(_), ColumnKind::Boolean)
            | (_, ColumnKind::Json) => true,
            (Value::Number(number), ColumnKind::Integer) => number.is_i64(),
            (Value::Number(_), ColumnKind::Real) => true,
            _ => false,
        };

        if !fits {
            return Err(bad(table, &format!("column {name} holds {value}")));
        }
    }

    Ok(())
}

/// The primary key as text: the JSON list of the key's values, in `primary_key` order.
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
                .ok_or_else(|| bad(table, &format!("key column {column} is absent")))
        })
        .collect::<Result<Vec<Value>, HostError>>()?;

    Ok(Value::Array(values).to_string())
}

fn to_sql(kind: ColumnKind, value: &Value) -> Result<turso::Value, HostError> {
    Ok(match (value, kind) {
        (Value::Null, _) => turso::Value::Null,
        (_, ColumnKind::Json) => turso::Value::from(serde_json::to_string(value)?),
        (Value::String(text), _) => turso::Value::from(text.as_str()),
        (Value::Bool(flag), _) => turso::Value::from(i64::from(*flag)),
        (Value::Number(number), ColumnKind::Real) => {
            turso::Value::from(number.as_f64().unwrap_or_default())
        }
        (Value::Number(number), _) => turso::Value::from(number.as_i64().unwrap_or_default()),
        (Value::Array(_) | Value::Object(_), _) => {
            return Err(HostError::BadOperation(
                "a list in a plain column".to_owned(),
            ));
        }
    })
}

fn from_sql(kind: ColumnKind, value: turso::Value) -> Result<Value, HostError> {
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
            return Err(HostError::BadOperation("a blob in a row".to_owned()));
        }
    })
}

fn key_values(info: &TableInfo, key: &str) -> Result<Vec<turso::Value>, HostError> {
    let Value::Array(values) = serde_json::from_str::<Value>(key)? else {
        return Err(HostError::BadOperation(format!("{key} is not a key")));
    };

    info.primary_key
        .iter()
        .zip(values.iter())
        .map(|(column, value)| to_sql(info.columns[column].kind, value))
        .collect()
}

fn key_filter(info: &TableInfo) -> String {
    info.primary_key
        .iter()
        .zip(1..)
        .map(|(column, index): (&String, usize)| format!("\"{column}\" = ?{index}"))
        .collect::<Vec<String>>()
        .join(" AND ")
}

/// # Errors
/// Fails when the query or a conversion fails.
pub async fn load_row(
    connection: &Connection,
    table: &str,
    info: &TableInfo,
    key: &str,
) -> Result<Option<Row>, HostError> {
    let names: Vec<&String> = info.columns.keys().collect();
    let list = names
        .iter()
        .map(|name| format!("\"{name}\""))
        .collect::<Vec<String>>()
        .join(", ");
    let mut rows = connection
        .query(
            &format!("SELECT {list} FROM \"{table}\" WHERE {}", key_filter(info)),
            key_values(info, key)?,
        )
        .await?;

    let Some(stored) = rows.next().await? else {
        return Ok(None);
    };

    Ok(Some(read_stored(info, &stored)?))
}

fn read_stored(info: &TableInfo, stored: &turso::Row) -> Result<Row, HostError> {
    let mut row = Row::new();

    for (index, (name, column)) in info.columns.iter().enumerate() {
        row.insert(
            name.clone(),
            from_sql(column.kind, stored.get_value(index)?)?,
        );
    }

    Ok(row)
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
    let quote = |names: Vec<&String>| {
        names
            .iter()
            .map(|name| format!("\"{name}\""))
            .collect::<Vec<String>>()
            .join(", ")
    };
    let mut rows = connection
        .query(
            &format!(
                "SELECT {} FROM \"{table}\" ORDER BY {}",
                quote(info.columns.keys().collect()),
                quote(info.primary_key.iter().collect())
            ),
            (),
        )
        .await?;
    let mut result = Vec::new();

    while let Some(stored) = rows.next().await? {
        result.push(read_stored(info, &stored)?);
    }

    Ok(result)
}

/// # Errors
/// Fails when the statement fails.
pub async fn write_row(
    connection: &Connection,
    table: &str,
    info: &TableInfo,
    row: &Row,
) -> Result<(), HostError> {
    let mut names = Vec::new();
    let mut marks = Vec::new();
    let mut values = Vec::new();

    for (index, (name, column)) in info.columns.iter().enumerate() {
        names.push(format!("\"{name}\""));
        marks.push(format!("?{}", index + 1));
        values.push(to_sql(column.kind, row.get(name).unwrap_or(&Value::Null))?);
    }

    connection
        .execute(
            &format!(
                "INSERT OR REPLACE INTO \"{table}\" ({}) VALUES ({})",
                names.join(", "),
                marks.join(", ")
            ),
            values,
        )
        .await?;

    Ok(())
}

/// # Errors
/// Fails when the statement fails.
pub async fn delete_row(
    connection: &Connection,
    table: &str,
    info: &TableInfo,
    key: &str,
) -> Result<(), HostError> {
    connection
        .execute(
            &format!("DELETE FROM \"{table}\" WHERE {}", key_filter(info)),
            key_values(info, key)?,
        )
        .await?;

    Ok(())
}

/// A Real column's number as a float, so a stored row compares equal to the same row on the wire.
pub fn normalize_row(info: &TableInfo, row: &mut Row) {
    for (name, column) in &info.columns {
        if column.kind == ColumnKind::Real
            && let Some(number) = row.get(name).and_then(Value::as_f64)
            && let Some(float) = Number::from_f64(number)
        {
            row.insert(name.clone(), Value::Number(float));
        }
    }
}
