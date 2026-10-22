//! Send feedback → relay → GitHub issues (Nested-style). App never holds a GitHub token.
//! LAMPCIRCLE_FEEDBACK_URL is compiled in: release builds get it from .github/workflows/release.yml,
//! local builds from src-tauri/.cargo/config.toml (see config.toml.example).

use crate::error::{AppError, Result};
use serde::Serialize;
use std::time::Duration;

pub const RELAY_URL: Option<&str> = option_env!("LAMPCIRCLE_FEEDBACK_URL");
pub const MAX_MESSAGE: usize = 5000;

#[derive(Serialize, Debug)]
pub struct AppInfo {
    pub version: String,
    pub os: &'static str,
    pub arch: &'static str,
}

#[derive(Serialize, Debug)]
pub struct Payload {
    pub message: String,
    pub app: AppInfo,
}

pub fn payload(message: &str, version: &str) -> Result<Payload> {
    let message = message.trim();
    if message.is_empty() {
        return Err(AppError::Message("Write a note first.".into()));
    }
    if message.chars().count() > MAX_MESSAGE {
        return Err(AppError::Message(format!(
            "Keep the note under {MAX_MESSAGE} characters."
        )));
    }
    Ok(Payload {
        message: message.to_owned(),
        app: AppInfo {
            version: version.to_owned(),
            os: std::env::consts::OS,
            arch: std::env::consts::ARCH,
        },
    })
}

pub fn relay_url(compiled: Option<&str>) -> Result<&str> {
    match compiled.map(str::trim).filter(|u| !u.is_empty()) {
        Some(url) => Ok(url),
        None => Err(AppError::Message(
            "Feedback isn't set up in this build.".into(),
        )),
    }
}

pub async fn send(url: &str, payload: &Payload) -> Result<()> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()?;
    let res = client.post(url).json(payload).send().await.map_err(|e| {
        if e.is_timeout() {
            AppError::Message("The feedback server didn't answer in time.".into())
        } else if e.is_connect() {
            AppError::Message("Couldn't reach the feedback server. Are you online?".into())
        } else {
            AppError::Http(e)
        }
    })?;
    if res.status().is_success() {
        return Ok(());
    }
    let status = res.status();
    let why = res.text().await.unwrap_or_default();
    let why = why.trim();
    let message =
        if why.is_empty() || why.len() > 200 || why.starts_with('<') || why.starts_with('{') {
            format!(
                "The feedback server refused the note ({}).",
                status.as_u16()
            )
        } else {
            why.to_owned()
        };
    Err(AppError::Message(message))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_trims_the_note() {
        assert_eq!(
            payload("  hi there \n", "0.1.0").unwrap().message,
            "hi there"
        );
    }

    #[test]
    fn empty_and_overlong_notes_are_refused() {
        assert!(payload(" \n ", "0.1.0").is_err());
        assert!(payload(&"x".repeat(MAX_MESSAGE), "0.1.0").is_ok());
        assert!(payload(&"x".repeat(MAX_MESSAGE + 1), "0.1.0").is_err());
    }

    #[test]
    fn payload_sends_only_the_note_and_app() {
        let json = serde_json::to_value(payload("hi", "0.1.0").unwrap()).unwrap();
        let mut keys: Vec<&str> = json
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(keys, ["app", "message"]);
        assert_eq!(json["app"]["version"], "0.1.0");
    }
}
