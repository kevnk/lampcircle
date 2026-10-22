use crate::error::Result;
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

static TEMP_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Writes JSON beside its destination, then renames it into place.
///
/// The PID and sequence keep two app processes from sharing a temporary file.
pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let json = serde_json::to_string_pretty(value)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let sequence = TEMP_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temporary_path =
        path.with_extension(format!("json.{}.{}.tmp", std::process::id(), sequence));
    std::fs::write(&temporary_path, json)?;

    if let Err(error) = std::fs::rename(&temporary_path, path) {
        let _ = std::fs::remove_file(&temporary_path);
        return Err(error.into());
    }
    Ok(())
}
