//! The blob store port: files that facts refer to, each stored under the SHA-256 of its bytes.

#[cfg(test)]
pub mod fixtures;
pub mod garage;
pub mod local_folder;

use std::fmt::Write as _;

use sha2::{Digest, Sha256};

use crate::error::HostError;

/// Blobs stored under their content hash, so a repeated write is harmless and a read of a hash
/// always returns the same bytes.
pub trait BlobStore {
    /// Stores `bytes` and returns their hash.
    ///
    /// # Errors
    /// Fails with [`HostError::BlobUnavailable`] when the store cannot take the write.
    fn write(&self, bytes: &[u8]) -> impl Future<Output = Result<String, HostError>> + Send;

    /// The bytes stored under `hash`.
    ///
    /// # Errors
    /// Fails with [`HostError::MissingBlob`] when no blob has that hash, and with
    /// [`HostError::BlobUnavailable`] when the store cannot be read.
    fn read(&self, hash: &str) -> impl Future<Output = Result<Vec<u8>, HostError>> + Send;
}

/// The SHA-256 of `bytes` in lowercase hex.
#[must_use]
pub fn build_blob_hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .fold(String::with_capacity(64), |mut hash, byte| {
            let _ = write!(hash, "{byte:02x}");

            hash
        })
}

/// Whether `text` is a hash a blob can be stored under, so it names no other path.
fn is_blob_hash(text: &str) -> bool {
    text.len() == 64
        && text
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

#[cfg(test)]
mod tests {
    use super::fixtures::{BLOB_STORE_FIXTURES, Fixture, run_blob_store_fixture};
    use super::local_folder::LocalFolderBlobStore;
    use crate::test_utils::read_fixture_files;

    macro_rules! local_folder_tests {
        ($($name:ident => $file:literal),* $(,)?) => {$(
            #[tokio::test]
            #[allow(clippy::expect_used)]
            async fn $name() {
                let directory = tempfile::tempdir().expect("a temporary directory");
                let store = LocalFolderBlobStore::new(directory.path());
                let fixture = Fixture::find($file);

                let returned = run_blob_store_fixture(&store, &fixture).await;

                assert_eq!(returned, fixture.expected_returns());
            }
        )*};
    }

    super::fixtures::for_each_blob_store_fixture!(local_folder_tests);

    #[test]
    fn it_runs_every_blob_store_fixture_file() {
        let listed: Vec<String> = BLOB_STORE_FIXTURES
            .iter()
            .map(|(name, _)| (*name).to_owned())
            .collect();

        assert_eq!(listed, read_fixture_files("blob-store"));
    }
}
