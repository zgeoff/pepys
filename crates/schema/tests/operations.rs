use pepys_schema::{GithubPullRequestDelete, GithubPullRequestKey, GithubPullRequestOperation};

#[test]
fn an_upsert_reads_the_wire_form_the_typescript_side_writes() -> Result<(), serde_json::Error> {
    let text = r#"{"upsert":{"github_pull_request":{
        "id":"github:pr:1","number":412,"repository_id":"github:repo:9","title":"add it",
        "state":"open","is_draft":false,"is_merged":false,"author_id":null,
        "url":"https://example.test/pr/412","merge_commit_sha":null,
        "created_at":"2026-10-24T01:02:03Z","updated_at":"2026-10-24T01:02:03Z",
        "closed_at":null,"merged_at":null,"payload":{"labels":["a"]}}}}"#;

    let operation: GithubPullRequestOperation = serde_json::from_str(text)?;

    assert_eq!(
        serde_json::to_value(&operation)?,
        serde_json::from_str::<serde_json::Value>(text)?
    );
    Ok(())
}

#[test]
fn a_delete_carries_the_primary_key_of_its_table() -> Result<(), serde_json::Error> {
    let operation = GithubPullRequestOperation::Delete(GithubPullRequestDelete::GithubPullRequest(
        GithubPullRequestKey {
            id: "github:pr:1".to_owned(),
        },
    ));

    assert_eq!(
        serde_json::to_string(&operation)?,
        r#"{"delete":{"github_pull_request":{"id":"github:pr:1"}}}"#
    );
    Ok(())
}
