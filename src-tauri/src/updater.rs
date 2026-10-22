//! Tauri updater wrapper (Nested pattern). Endpoint + pubkey live in tauri.conf.json.
//! Private signing key is a CI secret only — never commit it.

use crate::error::{AppError, Result};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::AppHandle;
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct Pending {
    update: Mutex<Option<Update>>,
    installing: AtomicBool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub current: String,
    pub supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update: Option<UpdateInfo>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum UpdateProgress {
    #[serde(rename_all = "camelCase")]
    Progress {
        downloaded: u64,
        total: Option<u64>,
    },
    Downloaded,
    Installed,
}

pub const SUPPORTED: bool = !cfg!(debug_assertions);

pub async fn check(app: &AppHandle, pending: &Pending) -> Result<UpdateCheck> {
    let current = app.package_info().version.to_string();
    if !SUPPORTED {
        crate::analytics::track_update_checked(app, "unsupported");
        return Ok(UpdateCheck {
            current,
            supported: false,
            update: None,
        });
    }
    let updater = app.updater().map_err(describe)?;
    match updater.check().await {
        Ok(available_update) => {
            let status = if available_update.is_some() {
                "available"
            } else {
                "latest"
            };
            let update = available_update.as_ref().map(|item| UpdateInfo {
                version: item.version.clone(),
                notes: item
                    .body
                    .as_deref()
                    .map(str::trim)
                    .filter(|body| !body.is_empty())
                    .map(str::to_owned),
            });
            *pending.update.lock().unwrap() = available_update;
            crate::analytics::track_update_checked(app, status);
            Ok(UpdateCheck {
                current,
                supported: true,
                update,
            })
        }
        Err(error) => {
            crate::analytics::track_update_checked(app, "error");
            Err(describe(error))
        }
    }
}

pub async fn install(
    app: &AppHandle,
    pending: &Pending,
    channel: Channel<UpdateProgress>,
) -> Result<()> {
    let update = pending
        .update
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| AppError::Message("Check for updates first.".into()))?;
    if pending.installing.swap(true, Ordering::SeqCst) {
        return Err(AppError::Message("An update is already installing.".into()));
    }
    let from_version = app.package_info().version.to_string();
    let to_version = update.version.clone();
    let downloaded = AtomicU64::new(0);
    let result = update
        .download_and_install(
            |chunk, total| {
                let so_far = downloaded.fetch_add(chunk as u64, Ordering::Relaxed) + chunk as u64;
                let _ = channel.send(UpdateProgress::Progress {
                    downloaded: so_far,
                    total,
                });
            },
            || {
                let _ = channel.send(UpdateProgress::Downloaded);
            },
        )
        .await
        .map_err(describe);
    pending.installing.store(false, Ordering::SeqCst);
    if result.is_ok() {
        let _ = channel.send(UpdateProgress::Installed);
        *pending.update.lock().unwrap() = None;
        crate::analytics::track_update_installed(app, &from_version, &to_version);
    }
    result
}

fn describe(error: tauri_plugin_updater::Error) -> AppError {
    use tauri_plugin_updater::Error;

    let message = match &error {
        Error::Reqwest(request) if request.is_timeout() => {
            "The update server didn't answer in time.".to_owned()
        }
        Error::Reqwest(request) if request.is_connect() => {
            "Couldn't reach the update server. Are you online?".to_owned()
        }
        Error::Reqwest(request) => format!(
            "The update server refused the request ({}).",
            request
                .status()
                .map(|status| status.as_u16().to_string())
                .unwrap_or_else(|| "no status".into())
        ),
        Error::Network(why) => format!("Couldn't download the update: {why}"),
        Error::Minisign(_) | Error::SignatureUtf8(_) => {
            "The update's signature didn't verify, so it was not installed.".to_owned()
        }
        Error::Io(io) => format!("Couldn't install the update: {io}"),
        other => other.to_string(),
    };
    AppError::Message(message)
}
