//! Writes that survive a crash: a file appears whole or not at all, and stays after a power loss.

use std::io::Write;
use std::path::Path;

use crate::error::HostError;

/// Writes `bytes` to `path` through a temporary file beside it, which it syncs and renames over
/// `path`, then syncs the folder so the rename itself survives a power loss.
///
/// # Errors
/// Fails when a write, the sync or the rename fails.
pub fn write_durably(path: &Path, bytes: &[u8]) -> Result<(), HostError> {
    let mut temporary = path.as_os_str().to_owned();

    temporary.push(".tmp");

    let mut file = std::fs::File::create(&temporary)?;

    file.write_all(bytes)?;
    file.sync_all()?;
    rename_durably(Path::new(&temporary), path)
}

/// Renames `from` over `to` and syncs the folder of `to`.
///
/// # Errors
/// Fails when the rename or the sync fails.
pub fn rename_durably(from: &Path, to: &Path) -> Result<(), HostError> {
    #[cfg(test)]
    rename_fault::check(to)?;

    std::fs::rename(from, to)?;

    if let Some(folder) = to.parent() {
        std::fs::File::open(folder)?.sync_all()?;
    }

    Ok(())
}

/// A one-shot stop that tests put before a rename, to leave the state a crash at that point
/// leaves.
#[cfg(test)]
pub(crate) mod rename_fault {
    use std::path::{Path, PathBuf};
    use std::sync::{Mutex, PoisonError};

    use crate::error::HostError;

    static ARMED: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

    /// Makes the next rename onto `to` fail before it renames anything.
    pub(crate) fn arm(to: &Path) {
        ARMED
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(to.to_owned());
    }

    /// Fails, once, a rename onto a path that a test armed.
    pub(crate) fn check(to: &Path) -> Result<(), HostError> {
        let mut armed = ARMED.lock().unwrap_or_else(PoisonError::into_inner);

        let Some(index) = armed.iter().position(|path| path == to) else {
            return Ok(());
        };

        armed.remove(index);

        Err(std::io::Error::other(format!("a stop before the rename onto {}", to.display())).into())
    }
}
