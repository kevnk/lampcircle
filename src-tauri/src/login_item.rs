//! Open-at-login commands backed by the official Tauri autostart plugin.
//!
//! `lib.rs` registers the plugin with the LaunchAgent macOS backend. Keeping these
//! small commands on the Rust side means the webview gets only the one boolean
//! setting this template needs, rather than direct access to every plugin command.

use crate::error::{AppError, Result};
use tauri::State;
use tauri_plugin_autostart::AutoLaunchManager;

#[tauri::command]
pub fn set_open_at_login(manager: State<'_, AutoLaunchManager>, enabled: bool) -> Result<bool> {
    let update = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    update
        .map_err(|error| AppError::Message(format!("Could not update Open at Login: {error}")))?;
    get_open_at_login(manager)
}

#[tauri::command]
pub fn get_open_at_login(manager: State<'_, AutoLaunchManager>) -> Result<bool> {
    manager
        .is_enabled()
        .map_err(|error| AppError::Message(format!("Could not read Open at Login: {error}")))
}
