//! Reads and writes of the `github_pull_request` table, the one table the slice owns.

use pepys_schema::{GithubPullRequestKey, GithubPullRequestRow};
use turso::{Connection, Value};

use crate::error::HostError;

pub const TABLE: &str = "github_pull_request";

const COLUMNS: &str = "id, number, repository_id, title, state, is_draft, is_merged, author_id, \
    url, merge_commit_sha, created_at, updated_at, closed_at, merged_at, payload";

/// Loads the row with primary key `key`.
///
/// # Errors
/// Fails when the query or a column conversion fails.
pub async fn load_row(
    connection: &Connection,
    key: &str,
) -> Result<Option<GithubPullRequestRow>, HostError> {
    let mut rows = connection
        .query(
            &format!("SELECT {COLUMNS} FROM {TABLE} WHERE id = ?1"),
            vec![Value::from(key)],
        )
        .await?;

    let Some(row) = rows.next().await? else {
        return Ok(None);
    };

    Ok(Some(GithubPullRequestRow {
        id: row.get(0)?,
        number: row.get(1)?,
        repository_id: row.get(2)?,
        title: row.get(3)?,
        state: row.get(4)?,
        is_draft: row.get::<i64>(5)? != 0,
        is_merged: row.get::<i64>(6)? != 0,
        author_id: row.get(7)?,
        url: row.get(8)?,
        merge_commit_sha: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        closed_at: row.get(12)?,
        merged_at: row.get(13)?,
        payload: serde_json::from_str(&row.get::<String>(14)?)?,
    }))
}

/// Writes `row`, replacing the row with the same key.
///
/// # Errors
/// Fails when the statement fails.
pub async fn write_row(
    connection: &Connection,
    row: &GithubPullRequestRow,
) -> Result<(), HostError> {
    let values = vec![
        Value::from(row.id.as_str()),
        Value::from(row.number),
        Value::from(row.repository_id.as_str()),
        Value::from(row.title.as_str()),
        Value::from(row.state.as_str()),
        Value::from(i64::from(row.is_draft)),
        Value::from(i64::from(row.is_merged)),
        Value::from(row.author_id.clone()),
        Value::from(row.url.as_str()),
        Value::from(row.merge_commit_sha.clone()),
        Value::from(row.created_at.as_str()),
        Value::from(row.updated_at.as_str()),
        Value::from(row.closed_at.clone()),
        Value::from(row.merged_at.clone()),
        Value::from(serde_json::to_string(&row.payload)?),
    ];

    connection
        .execute(
            &format!(
                "INSERT OR REPLACE INTO {TABLE} ({COLUMNS}) VALUES \
                 (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)"
            ),
            values,
        )
        .await?;

    Ok(())
}

/// Deletes the row with the key's primary key.
///
/// # Errors
/// Fails when the statement fails.
pub async fn delete_row(
    connection: &Connection,
    key: &GithubPullRequestKey,
) -> Result<(), HostError> {
    connection
        .execute(
            &format!("DELETE FROM {TABLE} WHERE id = ?1"),
            vec![Value::from(key.id.as_str())],
        )
        .await?;

    Ok(())
}

/// Every row, ordered by key.
///
/// # Errors
/// Fails when the query fails.
pub async fn load_all_rows(
    connection: &Connection,
) -> Result<Vec<GithubPullRequestRow>, HostError> {
    let mut keys = connection
        .query(&format!("SELECT id FROM {TABLE} ORDER BY id"), ())
        .await?;
    let mut ids: Vec<String> = Vec::new();

    while let Some(key_row) = keys.next().await? {
        ids.push(key_row.get(0)?);
    }

    let mut result = Vec::new();

    for id in ids {
        if let Some(row) = load_row(connection, &id).await? {
            result.push(row);
        }
    }

    Ok(result)
}
