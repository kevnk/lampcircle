//! Product-neutral last-session persistence.
//!
//! Nested keeps recent sessions in `recents.json` beside its settings. This template
//! uses the same app-config-directory pattern, but stores only the paths a future app
//! needs to reopen. Product-specific session state belongs in the product's own files.

use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const FILE_NAME: &str = "last-session.json";
const SCHEMA_VERSION: u8 = 1;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastSession {
    pub version: u8,
    #[serde(default)]
    pub paths: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_path: Option<String>,
    pub saved_at_ms: u64,
}

impl LastSession {
    fn normalize(mut self) -> Result<Self> {
        if self.version != SCHEMA_VERSION {
            return Err(AppError::Message(format!(
                "Last-session data uses unsupported version {}.",
                self.version
            )));
        }

        let mut seen = HashSet::new();
        self.paths
            .retain(|path| !path.is_empty() && seen.insert(path.clone()));

        if self
            .active_path
            .as_ref()
            .is_some_and(|active| !self.paths.contains(active))
        {
            return Err(AppError::Message(
                "The active session path must also appear in paths.".into(),
            ));
        }

        Ok(self)
    }
}

fn session_path(app: &AppHandle) -> Result<PathBuf> {
    Ok(app.path().app_config_dir()?.join(FILE_NAME))
}

fn now_ms() -> Result<u64> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| AppError::Message(format!("System clock is before 1970: {error}")))?;
    Ok(duration.as_millis().min(u128::from(u64::MAX)) as u64)
}

#[tauri::command]
pub fn get_last_session(app: AppHandle) -> Result<Option<LastSession>> {
    let file_path = session_path(&app)?;
    if !file_path.exists() {
        return Ok(None);
    }
    let session = serde_json::from_str::<LastSession>(&std::fs::read_to_string(file_path)?)?;
    Ok(Some(session.normalize()?))
}

#[tauri::command]
pub fn save_last_session(app: AppHandle, mut session: LastSession) -> Result<LastSession> {
    session.saved_at_ms = now_ms()?;
    let session = session.normalize()?;
    crate::storage::write_json_atomic(&session_path(&app)?, &session)?;
    Ok(session)
}

#[tauri::command]
pub fn clear_last_session(app: AppHandle) -> Result<()> {
    match std::fs::remove_file(session_path(&app)?) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(paths: &[&str], active_path: Option<&str>) -> LastSession {
        LastSession {
            version: SCHEMA_VERSION,
            paths: paths.iter().map(|path| (*path).to_owned()).collect(),
            active_path: active_path.map(str::to_owned),
            saved_at_ms: 0,
        }
    }

    #[test]
    fn normalization_removes_empty_and_duplicate_paths() {
        let normalized = session(&["/one", "", "/one", "/two"], Some("/two"))
            .normalize()
            .unwrap();
        assert_eq!(normalized.paths, ["/one", "/two"]);
    }

    #[test]
    fn active_path_must_be_in_the_session() {
        let error = session(&["/one"], Some("/two")).normalize().unwrap_err();
        assert!(error.to_string().contains("active session path"));
    }

    #[test]
    fn unknown_schema_versions_are_rejected() {
        let mut value = session(&[], None);
        value.version += 1;
        assert!(value.normalize().is_err());
    }
}
