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
    std::fs::rename(from, to)?;

    if let Some(folder) = to.parent() {
        std::fs::File::open(folder)?.sync_all()?;
    }

    Ok(())
}
