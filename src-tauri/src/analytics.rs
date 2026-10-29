//! Privacy-friendly desktop analytics via Aptabase, matching Nested Reader.
//!
//! The release build must provide `APTABASE_APP_KEY` at compile time. Without a
//! nonempty key every call is a no-op. The template's Settings opt-out is checked
//! from `settings.json` before each event; malformed settings fail closed.

#[cfg(feature = "aptabase")]
use freshjuice_tauri_aptabase::EventTracker;
#[cfg(feature = "aptabase")]
use serde_json::json;
use tauri::{AppHandle, Manager};

pub const APP_KEY: Option<&str> = option_env!("APTABASE_APP_KEY");

pub fn key_configured() -> bool {
    cfg!(feature = "aptabase") && APP_KEY.is_some_and(|key| !key.trim().is_empty())
}

fn user_enabled(app: &AppHandle) -> bool {
    let Ok(path) = app
        .path()
        .app_config_dir()
        .map(|dir| dir.join("settings.json"))
    else {
        return false;
    };
    if !path.exists() {
        return true;
    }
    let Ok(raw) = std::fs::read_to_string(path) else {
        return false;
    };
    let Ok(settings) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return false;
    };
    match settings.get("analyticsEnabled") {
        None => true,
        Some(serde_json::Value::Bool(enabled)) => *enabled,
        Some(_) => false,
    }
}

pub fn enabled(app: &AppHandle) -> bool {
    key_configured() && user_enabled(app)
}

pub fn track_app_opened(app: &AppHandle) {
    if !enabled(app) {
        return;
    }
    #[cfg(feature = "aptabase")]
    {
        let version = app.package_info().version.to_string();
        let _ = app.track_event("app_opened", Some(json!({ "version": version })));
    }
}

pub fn track_feedback_sent(app: &AppHandle) {
    if !enabled(app) {
        return;
    }
    #[cfg(feature = "aptabase")]
    {
        let _ = app.track_event("feedback_sent", None);
    }
}

pub fn track_update_checked(app: &AppHandle, result: &str) {
    if !enabled(app) {
        return;
    }
    #[cfg(not(feature = "aptabase"))]
    let _ = result;
    #[cfg(feature = "aptabase")]
    {
        let _ = app.track_event("update_checked", Some(json!({ "result": result })));
    }
}

#[cfg(desktop)]
pub fn track_update_installed(app: &AppHandle, from_version: &str, to_version: &str) {
    if !enabled(app) {
        return;
    }
    #[cfg(not(feature = "aptabase"))]
    let _ = (from_version, to_version);
    #[cfg(feature = "aptabase")]
    {
        let _ = app.track_event(
            "update_installed",
            Some(json!({ "from_version": from_version, "to_version": to_version })),
        );
    }
}

/// Future products call this when their AI request starts. The template has no AI feature.
#[allow(dead_code)]
pub fn track_ai_ask(app: &AppHandle, kind: &str) {
    if !enabled(app) {
        return;
    }
    #[cfg(not(feature = "aptabase"))]
    let _ = kind;
    #[cfg(feature = "aptabase")]
    {
        let _ = app.track_event("ai_ask", Some(json!({ "kind": kind })));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_must_be_nonempty() {
        assert_eq!(
            key_configured(),
            cfg!(feature = "aptabase") && APP_KEY.is_some_and(|key| !key.trim().is_empty())
        );
    }
}
