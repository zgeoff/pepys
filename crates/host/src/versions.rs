use std::path::Path;

use turso::Value;

use crate::database::{Store, open_store};
use crate::error::HostError;

/// The lifecycle of a consumer version, which moves only along `TRANSITIONS`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VersionState {
    Building,
    Previewed,
    Current,
    Previous,
    Removed,
}

const TRANSITIONS: [(VersionState, VersionState); 6] = [
    (VersionState::Building, VersionState::Previewed),
    (VersionState::Building, VersionState::Current),
    (VersionState::Previewed, VersionState::Current),
    (VersionState::Current, VersionState::Previous),
    (VersionState::Previous, VersionState::Current),
    (VersionState::Previous, VersionState::Removed),
];

impl VersionState {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Building => "building",
            Self::Previewed => "previewed",
            Self::Current => "current",
            Self::Previous => "previous",
            Self::Removed => "removed",
        }
    }

    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        [
            Self::Building,
            Self::Previewed,
            Self::Current,
            Self::Previous,
            Self::Removed,
        ]
        .into_iter()
        .find(|state| state.as_str() == text)
    }

    #[must_use]
    pub fn can_move_to(self, to: Self) -> bool {
        TRANSITIONS.contains(&(self, to))
    }
}

/// The host's own state file, `store/host.db`, which holds every consumer version's state. The
/// host is the one writer of version state.
pub struct HostState {
    store: Store,
}

impl HostState {
    /// # Errors
    /// Fails when the file cannot be opened or prepared.
    pub async fn open(path: &Path) -> Result<Self, HostError> {
        let store = open_store(path).await?;

        store
            .connection
            .execute(
                "CREATE TABLE IF NOT EXISTS versions (consumer TEXT NOT NULL, hash TEXT NOT NULL, \
                 state TEXT NOT NULL, PRIMARY KEY (consumer, hash))",
                (),
            )
            .await?;

        Ok(Self { store })
    }

    /// Records a version as building when it is not recorded yet.
    ///
    /// # Errors
    /// Fails when the statement fails.
    pub async fn register(&self, consumer: &str, hash: &str) -> Result<(), HostError> {
        self.store
            .connection
            .execute(
                "INSERT OR IGNORE INTO versions (consumer, hash, state) VALUES (?1, ?2, 'building')",
                vec![Value::from(consumer), Value::from(hash)],
            )
            .await?;

        Ok(())
    }

    /// # Errors
    /// Fails when the query fails.
    pub async fn state(
        &self,
        consumer: &str,
        hash: &str,
    ) -> Result<Option<VersionState>, HostError> {
        let mut rows = self
            .store
            .connection
            .query(
                "SELECT state FROM versions WHERE consumer = ?1 AND hash = ?2",
                vec![Value::from(consumer), Value::from(hash)],
            )
            .await?;

        let Some(row) = rows.next().await? else {
            return Ok(None);
        };
        let text: String = row.get(0)?;

        Ok(VersionState::parse(&text))
    }

    /// Moves a version along one edge of the transition table.
    ///
    /// # Errors
    /// Fails when the version is not recorded or the table has no such edge.
    pub async fn move_to(
        &self,
        consumer: &str,
        hash: &str,
        to: VersionState,
    ) -> Result<(), HostError> {
        let from = self
            .state(consumer, hash)
            .await?
            .ok_or_else(|| HostError::UnknownVersion(hash.to_owned()))?;

        if !from.can_move_to(to) {
            return Err(HostError::Transition {
                from: from.as_str().to_owned(),
                to: to.as_str().to_owned(),
            });
        }

        self.store
            .connection
            .execute(
                "UPDATE versions SET state = ?3 WHERE consumer = ?1 AND hash = ?2",
                vec![
                    Value::from(consumer),
                    Value::from(hash),
                    Value::from(to.as_str()),
                ],
            )
            .await?;

        Ok(())
    }

    /// The hash of the version in `state`, when there is one.
    ///
    /// # Errors
    /// Fails when the query fails.
    pub async fn find_hash(
        &self,
        consumer: &str,
        state: VersionState,
    ) -> Result<Option<String>, HostError> {
        let mut rows = self
            .store
            .connection
            .query(
                "SELECT hash FROM versions WHERE consumer = ?1 AND state = ?2",
                vec![Value::from(consumer), Value::from(state.as_str())],
            )
            .await?;

        match rows.next().await? {
            Some(row) => Ok(Some(row.get(0)?)),
            None => Ok(None),
        }
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    const ALL: [VersionState; 5] = [
        VersionState::Building,
        VersionState::Previewed,
        VersionState::Current,
        VersionState::Previous,
        VersionState::Removed,
    ];

    #[test]
    fn it_allows_exactly_the_edges_of_the_host_design() {
        let allowed: Vec<(&str, &str)> = ALL
            .iter()
            .flat_map(|from| ALL.iter().map(move |to| (*from, *to)))
            .filter(|(from, to)| from.can_move_to(*to))
            .map(|(from, to)| (from.as_str(), to.as_str()))
            .collect();

        assert_eq!(
            allowed,
            vec![
                ("building", "previewed"),
                ("building", "current"),
                ("previewed", "current"),
                ("current", "previous"),
                ("previous", "current"),
                ("previous", "removed"),
            ]
        );
    }

    #[test]
    fn it_parses_the_names_it_writes() {
        let parsed: Vec<Option<VersionState>> = ALL
            .iter()
            .map(|state| VersionState::parse(state.as_str()))
            .collect();

        assert_eq!(
            parsed,
            ALL.iter().map(|state| Some(*state)).collect::<Vec<_>>()
        );
    }

    async fn open_state() -> (tempfile::TempDir, HostState) {
        let directory = tempfile::tempdir().expect("a temporary directory");
        let state = HostState::open(&directory.path().join("host.db"))
            .await
            .expect("the host state");

        (directory, state)
    }

    #[tokio::test]
    async fn it_walks_a_fake_version_from_building_to_removed() {
        let (_directory, state) = open_state().await;

        state.register("fake", "aaa").await.expect("registered");
        state
            .move_to("fake", "aaa", VersionState::Previewed)
            .await
            .expect("previewed");
        state
            .move_to("fake", "aaa", VersionState::Current)
            .await
            .expect("current");
        state
            .move_to("fake", "aaa", VersionState::Previous)
            .await
            .expect("previous");
        state
            .move_to("fake", "aaa", VersionState::Current)
            .await
            .expect("current again");
        state
            .move_to("fake", "aaa", VersionState::Previous)
            .await
            .expect("previous again");
        state
            .move_to("fake", "aaa", VersionState::Removed)
            .await
            .expect("removed");

        assert_eq!(
            state.state("fake", "aaa").await.expect("a state"),
            Some(VersionState::Removed)
        );
    }

    #[tokio::test]
    async fn it_refuses_a_move_the_table_lacks_and_keeps_the_state() {
        let (_directory, state) = open_state().await;

        state.register("fake", "aaa").await.expect("registered");

        let refused = state.move_to("fake", "aaa", VersionState::Previous).await;

        assert_eq!(
            (
                refused.map_err(|error| error.to_string()),
                state.state("fake", "aaa").await.expect("a state"),
            ),
            (
                Err("a version cannot move from building to previous".to_owned()),
                Some(VersionState::Building)
            )
        );
    }

    #[tokio::test]
    async fn it_refuses_to_move_a_version_that_is_not_recorded() {
        let (_directory, state) = open_state().await;

        let refused = state.move_to("fake", "zzz", VersionState::Current).await;

        assert_eq!(
            refused.map_err(|error| error.to_string()),
            Err("version zzz is not recorded".to_owned())
        );
    }

    #[tokio::test]
    async fn it_finds_the_version_in_a_state_per_consumer() {
        let (_directory, state) = open_state().await;

        state.register("fake", "aaa").await.expect("registered");
        state.register("other", "bbb").await.expect("registered");
        state
            .move_to("fake", "aaa", VersionState::Current)
            .await
            .expect("current");
        state
            .move_to("other", "bbb", VersionState::Current)
            .await
            .expect("current");

        assert_eq!(
            (
                state
                    .find_hash("fake", VersionState::Current)
                    .await
                    .expect("a hash"),
                state
                    .find_hash("fake", VersionState::Previous)
                    .await
                    .expect("a hash"),
            ),
            (Some("aaa".to_owned()), None)
        );
    }
}
