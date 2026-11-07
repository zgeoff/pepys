//! Blobs as files in one folder, each named by its hash.

use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use super::{BlobStore, build_blob_hash, is_blob_hash};
use crate::error::HostError;

pub struct LocalFolderBlobStore {
    directory: PathBuf,
    writes: AtomicU64,
}

impl LocalFolderBlobStore {
    #[must_use]
    pub fn new(directory: &Path) -> Self {
        Self {
            directory: directory.to_owned(),
            writes: AtomicU64::new(0),
        }
    }
}

fn to_unavailable(error: &std::io::Error) -> HostError {
    HostError::BlobUnavailable(error.to_string())
}

impl BlobStore for LocalFolderBlobStore {
    fn write(&self, bytes: &[u8]) -> impl Future<Output = Result<String, HostError>> + Send {
        std::future::ready(self.write_file(bytes))
    }

    fn read(&self, hash: &str) -> impl Future<Output = Result<Vec<u8>, HostError>> + Send {
        std::future::ready(self.read_file(hash))
    }
}

impl LocalFolderBlobStore {
    /// A blob lands under its hash only once its bytes are complete, so a reader never sees part of
    /// one.
    fn write_file(&self, bytes: &[u8]) -> Result<String, HostError> {
        let hash = build_blob_hash(bytes);
        let write = self.writes.fetch_add(1, Ordering::Relaxed);
        let partial = self
            .directory
            .join(format!("{hash}.{}-{write}.partial", std::process::id()));

        let written = std::fs::write(&partial, bytes)
            .and_then(|()| std::fs::rename(&partial, self.directory.join(&hash)));

        if let Err(error) = written {
            let _ = std::fs::remove_file(&partial);

            return Err(to_unavailable(&error));
        }

        Ok(hash)
    }

    fn read_file(&self, hash: &str) -> Result<Vec<u8>, HostError> {
        if !is_blob_hash(hash) {
            return Err(HostError::MissingBlob(hash.to_owned()));
        }

        std::fs::read(self.directory.join(hash)).map_err(|error| {
            if error.kind() == ErrorKind::NotFound {
                HostError::MissingBlob(hash.to_owned())
            } else {
                to_unavailable(&error)
            }
        })
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn it_reports_a_missing_blob_for_a_hash_that_names_a_path_outside_the_folder() {
        let directory = tempfile::tempdir().expect("a temporary directory");
        let store = LocalFolderBlobStore::new(&directory.path().join("blobs"));

        std::fs::write(directory.path().join("outside"), "the harbour map").expect("a file");

        let read = store.read("../outside").await;

        assert!(matches!(read, Err(HostError::MissingBlob(_))));
    }

    #[tokio::test]
    async fn it_reports_a_write_to_a_folder_that_does_not_exist_as_unavailable() {
        let directory = tempfile::tempdir().expect("a temporary directory");
        let store = LocalFolderBlobStore::new(&directory.path().join("blobs"));

        let written = store.write(b"the harbour map").await;

        assert!(matches!(written, Err(HostError::BlobUnavailable(_))));
    }
}
