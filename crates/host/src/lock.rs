use std::fs::{File, OpenOptions};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::error::HostError;

/// The writer lock of one consumer: a file created exclusively and removed on drop. Whoever holds
/// it is the only process that writes the consumer's files or repoints its `current` link.
#[derive(Debug)]
pub struct WriterLock {
    path: PathBuf,
}

impl WriterLock {
    /// Takes the lock, waiting up to `wait` for the holder to let go.
    ///
    /// # Errors
    /// Fails with [`HostError::Locked`] when the lock stays held, or when the file cannot be made.
    pub async fn acquire(directory: &Path, wait: Duration) -> Result<Self, HostError> {
        let path = directory.join("writer.lock");
        let step = Duration::from_millis(25);
        let mut waited = Duration::ZERO;

        loop {
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(file) => {
                    drop::<File>(file);

                    return Ok(Self { path });
                }
                Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                    if waited >= wait {
                        return Err(HostError::Locked(directory.display().to_string()));
                    }

                    tokio::time::sleep(step).await;
                    waited += step;
                }
                Err(error) => return Err(error.into()),
            }
        }
    }
}

impl Drop for WriterLock {
    fn drop(&mut self) {
        // A lock file that cannot be removed leaves the consumer locked; the error has nowhere to
        // go from a destructor.
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn it_refuses_a_second_writer_until_the_first_lets_go() {
        let directory = tempfile::tempdir().expect("a directory");
        let first = WriterLock::acquire(directory.path(), Duration::ZERO)
            .await
            .expect("the first lock");
        let second = WriterLock::acquire(directory.path(), Duration::ZERO).await;

        assert!(second.is_err());

        drop(first);

        assert!(
            WriterLock::acquire(directory.path(), Duration::ZERO)
                .await
                .is_ok()
        );
    }
}
