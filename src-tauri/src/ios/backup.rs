//! Getting a library backup off the phone. The page sends the file a piece at a time over events, since a
//! library is hundreds of MB, and answers to each piece stop the backup as soon as a write fails. iOS's save dialog
//! then exports the whole file, and the copy here goes. `sendBackup` in src/lib/backup.ts is the other side.

use std::fs::{self, OpenOptions};
use std::io::{Error, Result, Write};
use std::path::{Path, PathBuf};

/// The save dialog exports only from Documents, so a backup waits there, in a folder that belongs to this code alone.
#[cfg(target_os = "ios")]
const FOLDER: &str = "lampcircle-backup";

/// Where a backup goes in a folder. Only a plain file name ending in .lampcircle gets a place.
fn staged(folder: &Path, name: &str) -> Result<PathBuf> {
    let plain = Path::new(name);
    let backup = plain.file_name() == Some(plain.as_os_str())
        && plain
            .extension()
            .is_some_and(|extension| extension == "lampcircle");
    if !backup {
        return Err(Error::other("That is not a backup's file name."));
    }
    Ok(folder.join(name))
}

fn from_hex(hex: &str) -> Option<Vec<u8>> {
    let digit = |byte: u8| (byte as char).to_digit(16).map(|value| value as u8);
    hex.as_bytes()
        .chunks(2)
        .map(|pair| match pair {
            [high, low] => Some(digit(*high)? << 4 | digit(*low)?),
            _ => None,
        })
        .collect()
}

/// Adds a piece to the file and says how long the file is now. A piece that does not follow the last one fails.
/// The first piece empties `folder` of whatever a run that never finished left.
fn write_piece(folder: &Path, name: &str, at: u64, hex: &str) -> Result<u64> {
    let path = staged(folder, name)?;
    let bytes = from_hex(hex).ok_or_else(|| Error::other("The backup was damaged on its way."))?;
    if at == 0 {
        if folder.exists() {
            fs::remove_dir_all(folder)?;
        }
        fs::create_dir_all(folder)?;
    }
    let mut file = OpenOptions::new()
        .create(at == 0)
        .append(true)
        .open(&path)?;
    if file.metadata()?.len() != at {
        return Err(Error::other("The backup lost its place."));
    }
    file.write_all(&bytes)?;
    Ok(at + bytes.len() as u64)
}

/// Puts the file on disk and checks all of it arrived, before anything offers it as a backup.
fn check_whole(folder: &Path, name: &str, size: u64) -> Result<()> {
    let file = OpenOptions::new()
        .append(true)
        .open(staged(folder, name)?)?;
    file.sync_all()?;
    if file.metadata()?.len() != size {
        return Err(Error::other("The backup came out the wrong size."));
    }
    Ok(())
}

#[cfg(target_os = "ios")]
pub fn start(app: &tauri::App) {
    use serde_json::{json, Value};
    use tauri::{AppHandle, Emitter, Listener, Manager};
    use tauri_plugin_dialog::DialogExt;

    #[derive(serde::Deserialize)]
    #[serde(tag = "step", rename_all = "lowercase")]
    enum Step {
        Piece { name: String, at: u64, hex: String },
        Finish { name: String, size: u64 },
    }

    fn tell_page(app: &AppHandle, result: Result<Value>) {
        let reply = result.unwrap_or_else(|error| json!({ "error": error.to_string() }));
        if let Err(error) = app.emit_to("main", "backup-reply", reply) {
            log::warn!("Could not answer the page about the backup: {error}");
        }
    }

    // No backup runs at launch, so anything here is left from one the app was force-quit during.
    if let Ok(documents) = app.path().document_dir() {
        let _ = fs::remove_dir_all(documents.join(FOLDER));
    }

    let handle = app.handle().clone();
    app.listen("backup", move |event| {
        let app = handle.clone();
        let step = serde_json::from_str::<Step>(event.payload()).map_err(Error::other);
        let documents = app.path().document_dir().map_err(Error::other);
        let (step, folder) = match (step, documents) {
            (Ok(step), Ok(documents)) => (step, documents.join(FOLDER)),
            (Err(error), _) | (_, Err(error)) => return tell_page(&app, Err(error)),
        };
        match step {
            Step::Piece { name, at, hex } => {
                let written = write_piece(&folder, &name, at, &hex);
                if written.is_err() {
                    let _ = fs::remove_dir_all(&folder);
                }
                tell_page(&app, written.map(|written| json!({ "written": written })));
            }
            // Tauri holds its event lock while a listener runs, and this dialog stays open as long as the person likes.
            Step::Finish { name, size } => {
                tauri::async_runtime::spawn_blocking(move || {
                    let saved = check_whole(&folder, &name, size).map(|()| {
                        // A path under Documents. The file goes out under its last part alone.
                        let dialog = app
                            .dialog()
                            .file()
                            .set_file_name(format!("{FOLDER}/{name}"));
                        json!({ "saved": dialog.blocking_save_file().is_some() })
                    });
                    let _ = fs::remove_dir_all(&folder);
                    tell_page(&app, saved);
                });
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(test: &str) -> PathBuf {
        let folder =
            std::env::temp_dir().join(format!("lampcircle-backup-{test}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&folder);
        folder
    }

    #[test]
    fn writes_the_pieces_in_order() {
        let folder = folder("order");
        assert_eq!(write_piece(&folder, "a.lampcircle", 0, "00ff").unwrap(), 2);
        assert_eq!(write_piece(&folder, "a.lampcircle", 2, "7A").unwrap(), 3);
        assert_eq!(
            fs::read(folder.join("a.lampcircle")).unwrap(),
            [0, 255, 122]
        );
        check_whole(&folder, "a.lampcircle", 3).unwrap();
        fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn a_missing_piece_or_a_short_file_fails() {
        let folder = folder("gaps");
        write_piece(&folder, "a.lampcircle", 0, "00ff").unwrap();
        assert!(write_piece(&folder, "a.lampcircle", 3, "00").is_err());
        assert_eq!(fs::read(folder.join("a.lampcircle")).unwrap(), [0, 255]);
        assert!(check_whole(&folder, "a.lampcircle", 3).is_err());
        assert!(write_piece(&folder, "never-started.lampcircle", 2, "00").is_err());
        fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn the_first_piece_clears_what_a_stopped_run_left() {
        let folder = folder("clear");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("old.lampcircle"), "old").unwrap();
        fs::write(folder.join("a.lampcircle"), "old").unwrap();
        write_piece(&folder, "a.lampcircle", 0, "00").unwrap();
        assert!(!folder.join("old.lampcircle").exists());
        assert_eq!(fs::read(folder.join("a.lampcircle")).unwrap(), [0]);
        fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn refuses_other_names_and_damaged_pieces() {
        let folder = folder("refuse");
        for name in [
            "../a.lampcircle",
            "/tmp/a.lampcircle",
            "a.djw",
            "lampcircle",
            "..",
        ] {
            assert!(write_piece(&folder, name, 0, "00").is_err(), "{name}");
        }
        for hex in ["0", "zz", "é0"] {
            assert!(
                write_piece(&folder, "a.lampcircle", 0, hex).is_err(),
                "{hex}"
            );
        }
        assert!(!folder.exists());
    }
}
