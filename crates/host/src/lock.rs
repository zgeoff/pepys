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

                    if waited.is_zero() {
                        eprintln!(
                            "pepys: waiting for the writer lock of {}",
                            directory.display()
                        );
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
    use crate::test_utils::{collect_stderr, wait_for};

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

    const CHILD_DIRECTORY: &str = "PEPYS_LOCK_TEST_CHILD_DIRECTORY";
    const CHILD_NAME: &str = "PEPYS_LOCK_TEST_CHILD_NAME";
    const TURNS: usize = 4;
    const LIMIT: Duration = Duration::from_secs(4);

    /// The body of the second process, which the test below starts by running this test binary
    /// again on this one test. In a normal run no variable is set, and it does nothing.
    #[tokio::test]
    async fn it_writes_in_turns_as_the_second_process_of_the_lock_test() {
        let (Ok(directory), Ok(name)) = (std::env::var(CHILD_DIRECTORY), std::env::var(CHILD_NAME))
        else {
            return;
        };

        write_turns(Path::new(&directory), &name).await;
    }

    /// Takes the lock for each of `TURNS` turns and, while it holds it, writes a `begin` line, waits
    /// and writes an `end` line to the shared file.
    async fn write_turns(directory: &Path, name: &str) {
        use std::io::Write;

        for _ in 0..TURNS {
            let lock = WriterLock::acquire(directory, Duration::from_secs(4))
                .await
                .expect("the lock");
            let mut file = OpenOptions::new()
                .append(true)
                .create(true)
                .open(directory.join("turns.log"))
                .expect("the turns file");

            writeln!(file, "begin {name}").expect("a line");
            tokio::time::sleep(Duration::from_millis(40)).await;
            writeln!(file, "end {name}").expect("a line");
            drop(lock);
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }

    #[tokio::test]
    async fn it_keeps_a_second_process_from_writing_while_this_one_holds_the_lock() {
        let directory = tempfile::tempdir().expect("a directory");
        let held = WriterLock::acquire(directory.path(), Duration::ZERO)
            .await
            .expect("the lock");
        let mut child = std::process::Command::new(std::env::current_exe().expect("this binary"))
            .args([
                "--exact",
                "lock::tests::it_writes_in_turns_as_the_second_process_of_the_lock_test",
                "--nocapture",
            ])
            .env(CHILD_DIRECTORY, directory.path())
            .env(CHILD_NAME, "child")
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("a second process");

        // A child that waits for the lock says so, and writes nothing meanwhile.
        let said = collect_stderr(&mut child);

        wait_for("the child never waited for the lock", LIMIT, async || {
            said.lock()
                .expect("the lines")
                .iter()
                .any(|line| line.contains("waiting for the writer lock"))
                .then_some(())
        })
        .await;

        assert!(!directory.path().join("turns.log").exists());

        drop(held);

        // The two processes then take turns for as long as the child runs: the parent's turns and
        // the child's never overlap in the file.
        write_turns(directory.path(), "parent").await;

        assert!(child.wait().expect("the child's end").success());

        let turns = std::fs::read_to_string(directory.path().join("turns.log")).expect("the turns");
        let lines: Vec<&str> = turns.lines().collect();

        assert_eq!(lines.len(), TURNS * 4);
        assert!(
            lines.chunks(2).all(|pair| {
                pair[0].strip_prefix("begin ") == pair[1].strip_prefix("end ")
                    && pair[0].starts_with("begin ")
            }),
            "the processes wrote at the same time:\n{turns}"
        );
        assert_eq!(
            lines.iter().filter(|line| line.ends_with("child")).count(),
            TURNS * 2
        );
    }
}
