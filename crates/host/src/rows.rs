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

// `Number.MAX_SAFE_INTEGER`: past it, a TypeScript reader and the float compare of the scope
// replace can no longer tell two integers apart.
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

// An integer column refuses a number written with a fraction or an exponent, even `5.0`: serde
// reads such a number as a float. It refuses an integer outside the safe range too, as the test
// store does with `Number.isSafeInteger`.
fn fits(column: ColumnInfo, value: &Value) -> bool {
    match (value, column.kind) {
        (Value::Null, _) => column.nullable,
        (Value::String(_), ColumnKind::Text | ColumnKind::EntityId | ColumnKind::Timestamp)
        | (Value::Bool(_), ColumnKind::Boolean)
        | (Value::Number(_), ColumnKind::Real)
        | (_, ColumnKind::Json) => true,
        (Value::Number(number), ColumnKind::Integer) => number
            .as_i64()
            .is_some_and(|integer| integer.unsigned_abs() <= MAX_SAFE_INTEGER),
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

/// The primary key as text: the JSON list of the key's values, in primary key order, as
/// `JSON.stringify` writes it, except that an object's keys come sorted. One form for a key of one
/// column and of several. The change log and `scope_row` hold it, so equal numbers, such as `2` and
/// `2.0`, give one key.
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

    Ok(format_js_json(&Value::Array(values)))
}

// JSON text as `JSON.stringify` writes it, except that an object's keys come sorted: serde_json's
// map keeps no insertion order. A value with no object gives the test store's text. Each number
// is a double, written as JavaScript writes one.
fn format_js_json(value: &Value) -> String {
    match value {
        Value::Number(number) => number
            .as_f64()
            .map_or_else(|| number.to_string(), format_js_number),
        Value::Array(items) => {
            let items: Vec<String> = items.iter().map(format_js_json).collect();

            format!("[{}]", items.join(","))
        }
        Value::Object(map) => {
            let entries: Vec<String> = map
                .iter()
                .map(|(name, item)| {
                    format!("{}:{}", Value::String(name.clone()), format_js_json(item))
                })
                .collect();

            format!("{{{}}}", entries.join(","))
        }
        Value::Null | Value::Bool(_) | Value::String(_) => value.to_string(),
    }
}

// ECMAScript's Number::toString for a finite double: the shortest digits that round-trip, the
// point placed by the exponent.
fn format_js_number(number: f64) -> String {
    if number == 0.0 {
        return "0".to_owned();
    }

    let (digits, exponent) = pick_shortest_digits(number.abs());
    let point = exponent + 1;
    let count = i32::try_from(digits.len()).unwrap_or(i32::MAX);
    let sign = if number < 0.0 { "-" } else { "" };
    let zeros = |count: i32| "0".repeat(usize::try_from(count).unwrap_or(0));

    let text = if count <= point && point <= 21 {
        format!("{digits}{}", zeros(point - count))
    } else if 0 < point && point <= 21 {
        let (whole, fraction) = digits.split_at(usize::try_from(point).unwrap_or(0));

        format!("{whole}.{fraction}")
    } else if -6 < point && point <= 0 {
        format!("0.{}{digits}", zeros(-point))
    } else {
        let (first, rest) = digits.split_at(1);
        let power = point - 1;
        let power_sign = if power < 0 { "-" } else { "+" };
        let point_and_rest = if rest.is_empty() {
            String::new()
        } else {
            format!(".{rest}")
        };

        format!("{first}{point_and_rest}e{power_sign}{}", power.abs())
    };

    format!("{sign}{text}")
}

// The shortest digits of a positive double and the power of ten of the first digit. Rust's `{:e}`
// gives shortest digits that round-trip, but when the double lies exactly halfway between two such
// texts it takes the upper one, and ECMAScript takes the one whose last digit is even.
fn pick_shortest_digits(magnitude: f64) -> (String, i32) {
    let (digits, exponent) = to_digits_and_exponent(&format!("{magnitude:e}"));
    // 1100 digits hold the exact expansion of every double.
    let (exact, exact_exponent) = to_digits_and_exponent(&format!("{magnitude:.1100e}"));

    if exact_exponent != exponent || exact.len() <= digits.len() {
        return (digits, exponent);
    }

    let (lower, rest) = exact.split_at(digits.len());
    let is_halfway = rest.starts_with('5') && rest[1..].bytes().all(|digit| digit == b'0');
    let upper = increment_digits(lower);

    if !is_halfway || upper.len() != lower.len() {
        return (digits, exponent);
    }

    let round_trips = |candidate: &str| {
        let (first, others) = candidate.split_at(1);

        format!("{first}.{others}e{exponent}").parse::<f64>() == Ok(magnitude)
    };
    let even = [lower, upper.as_str()].into_iter().find(|candidate| {
        candidate
            .bytes()
            .last()
            .is_some_and(|digit| (digit - b'0').is_multiple_of(2))
            && round_trips(candidate)
    });

    match even {
        Some(candidate) => {
            let trimmed = candidate.trim_end_matches('0');

            (
                if trimmed.is_empty() { "0" } else { trimmed }.to_owned(),
                exponent,
            )
        }
        None => (digits, exponent),
    }
}

fn to_digits_and_exponent(scientific: &str) -> (String, i32) {
    let (mantissa, exponent) = scientific.split_once('e').unwrap_or((scientific, "0"));

    (
        mantissa.chars().filter(char::is_ascii_digit).collect(),
        exponent.parse().unwrap_or(0),
    )
}

fn increment_digits(digits: &str) -> String {
    let mut bytes = digits.as_bytes().to_vec();

    for byte in bytes.iter_mut().rev() {
        if *byte == b'9' {
            *byte = b'0';
        } else {
            *byte += 1;

            return String::from_utf8_lossy(&bytes).into_owned();
        }
    }

    format!("1{}", String::from_utf8_lossy(&bytes))
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
        ColumnKind::Boolean => Value::Bool(
            argument
                .parse::<bool>()
                .map_err(|_| bad_row(table, format!("{argument} is no boolean key")))?,
        ),
        ColumnKind::Text
        | ColumnKind::EntityId
        | ColumnKind::Timestamp
        | ColumnKind::Real
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
        // The text the key holds, so that a JSON key binds what the row stored.
        (_, ColumnKind::Json) => turso::Value::from(format_js_json(value)),
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
    fn it_refuses_an_integer_past_the_safe_integers_and_accepts_the_largest_safe_one() {
        let checks: Vec<(i64, bool)> = [
            9_007_199_254_740_991,
            9_007_199_254_740_992,
            -9_007_199_254_740_991,
            -9_007_199_254_740_992,
        ]
        .into_iter()
        .map(|day| {
            let mut row = entry();

            row.insert("day".to_owned(), json!(day));

            (day, check_row("ledger_entry", &ledger(), &row).is_ok())
        })
        .collect();

        assert_eq!(
            checks,
            vec![
                (9_007_199_254_740_991, true),
                (9_007_199_254_740_992, false),
                (-9_007_199_254_740_991, true),
                (-9_007_199_254_740_992, false),
            ]
        );
    }

    // The texts are what `JSON.stringify(JSON.parse(text))` gives in JavaScript.
    #[test]
    fn it_writes_a_key_as_json_stringify_writes_it() {
        let info: TableInfo = serde_json::from_value(json!({
            "columns": {"id": {"kind": "json", "nullable": false}},
            "primaryKey": ["id"],
            "indexes": [],
        }))
        .expect("a table");
        let expected: Vec<(&str, &str)> = vec![
            ("2.0", "[2]"),
            ("1.25", "[1.25]"),
            ("1e21", "[1e+21]"),
            ("1e20", "[100000000000000000000]"),
            ("1e-7", "[1e-7]"),
            ("0.000001", "[0.000001]"),
            ("-0.0", "[0]"),
            ("-2.5", "[-2.5]"),
            ("1.5e-7", "[1.5e-7]"),
            ("123456789.125", "[123456789.125]"),
            (r#"["a",2.50,true,null]"#, r#"[["a",2.5,true,null]]"#),
            ("0.30000000000000004", "[0.30000000000000004]"),
            ("5e-324", "[5e-324]"),
            ("1.7976931348623157e308", "[1.7976931348623157e+308]"),
            // Near 2^53, where a double holds no fraction and steps by 2.
            ("9007199254740993", "[9007199254740992]"),
            ("9007199254740995", "[9007199254740996]"),
            ("9007199254740991.5", "[9007199254740992]"),
            ("4503599627370495.5", "[4503599627370495.5]"),
            // Long texts that a fast float parse rounds to a neighbouring double.
            ("3713064193725.5859", "[3713064193725.586]"),
            ("1.5515404846519232e-9", "[1.5515404846519232e-9]"),
            ("-0.0038866138458251956", "[-0.0038866138458251956]"),
            // Doubles halfway between two shortest texts: JavaScript takes the even last digit.
            ("1000000000000000.2", "[1000000000000000.2]"),
            ("83897829055786.125", "[83897829055786.12]"),
            ("95844.268798828125", "[95844.26879882812]"),
        ];
        let keys: Vec<(&str, String)> = expected
            .iter()
            .map(|(text, _)| {
                let value: Value = serde_json::from_str(text).expect("a value");

                (
                    *text,
                    key_of("item", &info, &row(json!({ "id": value }))).expect("a key"),
                )
            })
            .collect();

        assert_eq!(
            keys,
            expected
                .iter()
                .map(|(text, key)| (*text, (*key).to_owned()))
                .collect::<Vec<(&str, String)>>()
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
    fn it_refuses_a_row_read_of_a_boolean_key_that_is_neither_true_nor_false() {
        let mut info = ledger();

        info.primary_key = vec!["is_open".to_owned()];

        assert_eq!(
            key_of_read("ledger_entry", &info, "1").map_err(|error| error.to_string()),
            Err(bad_row("ledger_entry", "1 is no boolean key".to_owned()).to_string())
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

    /// Writes a row of a table keyed by one column of `kind`, then loads it by the key a module's
    /// row read passes as `argument`.
    async fn load_by_row_read(
        kind: &str,
        declared: &str,
        key: Value,
        argument: &str,
    ) -> Option<Row> {
        let directory = tempfile::tempdir().expect("a directory");
        let store = open_store(&directory.path().join("rows.db"))
            .await
            .expect("a store");
        let info: TableInfo = serde_json::from_value(json!({
            "columns": {
                "key": {"kind": kind, "nullable": false},
                "note": {"kind": "text", "nullable": false},
            },
            "primaryKey": ["key"],
            "indexes": [],
        }))
        .expect("a table");

        store
            .connection
            .execute_batch(&format!(
                "CREATE TABLE tide_mark (\"key\" {declared} NOT NULL, \"note\" TEXT NOT NULL, \
                 PRIMARY KEY (\"key\"))"
            ))
            .await
            .expect("a table");
        write_row(
            &store.connection,
            "tide_mark",
            &info,
            &row(json!({"key": key, "note": "Spring tide"})),
        )
        .await
        .expect("a written row");

        let read = key_of_read("tide_mark", &info, argument).expect("a key");

        load_row(&store.connection, "tide_mark", &info, &read)
            .await
            .expect("a load")
    }

    #[tokio::test]
    async fn it_loads_the_row_of_a_true_boolean_key_from_a_row_read() {
        assert_eq!(
            load_by_row_read("boolean", "INTEGER", json!(true), "true").await,
            Some(row(json!({"key": true, "note": "Spring tide"})))
        );
    }

    #[tokio::test]
    async fn it_loads_the_row_of_a_false_boolean_key_from_a_row_read() {
        assert_eq!(
            load_by_row_read("boolean", "INTEGER", json!(false), "false").await,
            Some(row(json!({"key": false, "note": "Spring tide"})))
        );
    }

    #[tokio::test]
    async fn it_loads_the_row_of_a_real_key_from_a_row_read() {
        assert_eq!(
            load_by_row_read("real", "REAL", json!(2.5), "2.5").await,
            Some(row(json!({"key": 2.5, "note": "Spring tide"})))
        );
    }
}
