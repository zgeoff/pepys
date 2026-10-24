use std::fs::{File, OpenOptions, TryLockError};
use std::path::Path;
use std::time::Duration;

use crate::error::HostError;

/// The writer lock of one consumer: an OS file lock held for as long as this value lives. Whoever
/// holds it is the only process that writes the consumer's files or repoints its `current` link.
/// The kernel drops the lock when its holder exits, however it exits, so a crashed writer never
/// leaves the consumer locked.
#[derive(Debug)]
pub struct WriterLock {
    _file: File,
}

impl WriterLock {
    /// Takes the lock, waiting up to `wait` for the holder to let go.
    ///
    /// # Errors
    /// Fails with [`HostError::Locked`] when the lock stays held, or when the file cannot be made.
    pub async fn acquire(directory: &Path, wait: Duration) -> Result<Self, HostError> {
        std::fs::create_dir_all(directory)?;

        let file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(false)
            .open(directory.join("writer.lock"))?;
        let step = Duration::from_millis(25);
        let mut waited = Duration::ZERO;

        loop {
            match file.try_lock() {
                Ok(()) => return Ok(Self { _file: file }),
                Err(TryLockError::WouldBlock) => {
                    if waited >= wait {
                        return Err(HostError::Locked(directory.display().to_string()));
                    }

                    tokio::time::sleep(step).await;
                    waited += step;
                }
                Err(TryLockError::Error(error)) => return Err(error.into()),
            }
        }
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

    #[tokio::test]
    async fn it_takes_a_lock_file_that_a_dead_writer_left_behind() {
        let directory = tempfile::tempdir().expect("a directory");

        std::fs::write(directory.path().join("writer.lock"), b"").expect("a stale lock file");

        assert!(
            WriterLock::acquire(directory.path(), Duration::ZERO)
                .await
                .is_ok()
        );
    }
}
