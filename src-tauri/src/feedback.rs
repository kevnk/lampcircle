//! Send feedback → relay → GitHub issues (Nested-style). App never holds a GitHub token.
//! Set LAMPCIRCLE_FEEDBACK_URL via src-tauri/.cargo/config.toml (see config.toml.example).

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    pub app: AppInfo,
}

pub fn payload(message: &str, email: Option<&str>, version: &str) -> Result<Payload> {
    let message = message.trim();
    if message.is_empty() {
        return Err(AppError::Message("Write a note first.".into()));
    }
    if message.chars().count() > MAX_MESSAGE {
        return Err(AppError::Message(format!(
            "Keep the note under {MAX_MESSAGE} characters."
        )));
    }
    let email = email
        .map(str::trim)
        .filter(|e| !e.is_empty())
        .map(str::to_owned);
    Ok(Payload {
        message: message.to_owned(),
        email,
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
