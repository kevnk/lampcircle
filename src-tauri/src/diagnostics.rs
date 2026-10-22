use crate::error::{AppError, Result};
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::LazyLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

pub const LOG_FILE_NAME: &str = "lampcircle";
pub const SUPPORT_LOG_TARGET: &str = "lampcircle_support";
pub const MAX_LOG_FILE_SIZE: u128 = 1_000_000;
pub const LOG_FILES_TO_KEEP: usize = 3;

const MAX_EXPORTED_LOG_BYTES: u64 = 2_000_000;
const MAX_EXPORTED_LOG_TOTAL_BYTES: u64 = 3_000_000;
const README: &str = "\
Lamp Circle diagnostics

This archive was created locally for support. Nothing was uploaded.

Privacy protections:
- Keychain data is never read.
- settings.redacted.json contains only validated, non-secret preferences and a shortcut-override count.
- Log files contain only explicit support-lifecycle events and are scrubbed for common secret and personal-data patterns.

Review this archive before attaching it to feedback.
";

static TEMP_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

static APP_LOG_FILE_NAME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(
        r"^{}(?:_\d{{4}}-\d{{2}}-\d{{2}}_\d{{2}}-\d{{2}}-\d{{2}})?\.log(?:\.bak)?$",
        regex::escape(LOG_FILE_NAME)
    ))
    .expect("app log filename regex must compile")
});
static PRIVATE_KEY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?is)-----BEGIN [^-\r\n]*PRIVATE KEY-----.*?(?:-----END [^-\r\n]*PRIVATE KEY-----|\z)",
    )
    .expect("private-key redaction regex must compile")
});
static KNOWN_TOKEN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(?:sk[-_](?:live|test|proj)[-_][A-Za-z0-9_-]{8,}|github_pat_[A-Za-z0-9_]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|A(?:KI|SI)A[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,})\b",
    )
    .expect("known-token redaction regex must compile")
});
static URI_CREDENTIALS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?P<prefix>\b[a-z][a-z0-9+.-]*://)[^/@\s:]+:[^/@\s]+@")
        .expect("URI credential redaction regex must compile")
});
static SECRET_HEADER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)(?P<prefix>\b(?:authorization|proxy-authorization|cookie|set-cookie)[ \t]*:[ \t]*)[^\r\n]*",
    )
    .expect("secret header redaction regex must compile")
});
static BEARER_TOKEN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?P<prefix>\bbearer\s+)[A-Za-z0-9._~+/=-]{8,}")
        .expect("bearer-token redaction regex must compile")
});
static JSON_SECRET: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)(?P<prefix>"[^"\r\n]*(?:api[_-]?key|secret|token|password|passwd|authorization|cookie|credential|private[_-]?key)[^"\r\n]*"\s*:\s*)(?:"[^"\r\n]*"|[^,\s}\r\n]+)"#,
    )
    .expect("JSON secret redaction regex must compile")
});
static ASSIGNED_SECRET: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)(?P<prefix>\b[A-Z0-9_.-]*(?:api[_-]?key|secret|token|password|passwd|authorization|cookie|credential|private[_-]?key)[A-Z0-9_.-]*\b(?:\s*(?:=|:)\s*|\s+))(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)"#,
    )
    .expect("assigned-secret redaction regex must compile")
});
static EMAIL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b")
        .expect("email redaction regex must compile")
});
static MAC_HOME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?P<prefix>/Users/)[^\s"'<>]+"#).expect("macOS home redaction regex must compile")
});
static UNIX_HOME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?P<prefix>/home/)[^\s"'<>]+"#).expect("Unix home redaction regex must compile")
});
static WINDOWS_HOME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)(?P<prefix>[A-Z]:\\Users\\)[^\s"'<>]+"#)
        .expect("Windows home redaction regex must compile")
});

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsExport {
    path: String,
    log_files: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BundleMetadata {
    schema_version: u8,
    generated_at_unix_seconds: u64,
    app_name: String,
    app_version: String,
    app_identifier: String,
    os: &'static str,
    arch: &'static str,
}

#[derive(Debug)]
struct LogSnapshot {
    name: String,
    contents: String,
    truncated: bool,
}

#[tauri::command]
pub async fn export_diagnostics(app: AppHandle) -> Result<Option<DiagnosticsExport>> {
    let generated_at = unix_time();
    let default_name = format!(
        "{}-diagnostics-{generated_at}.zip",
        file_name_slug(&app.package_info().name)
    );

    let mut dialog = app
        .dialog()
        .file()
        .set_title("Export diagnostics")
        .set_file_name(default_name)
        .add_filter("ZIP archive", &["zip"]);
    if let Some(settings_window) = app.get_webview_window("settings") {
        dialog = dialog.set_parent(&settings_window);
    }

    let Some(destination) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let destination = destination.into_path().map_err(|_| {
        AppError::Message("The selected diagnostics destination is not a local file.".into())
    })?;

    let metadata = BundleMetadata {
        schema_version: 1,
        generated_at_unix_seconds: generated_at,
        app_name: app.package_info().name.clone(),
        app_version: app.package_info().version.to_string(),
        app_identifier: app.config().identifier.clone(),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
    };
    let log_files = write_bundle(
        &destination,
        &crate::settings_path(&app)?,
        &app.path().app_log_dir()?,
        &metadata,
    )?;
    log::info!(
        target: SUPPORT_LOG_TARGET,
        "diagnostics_export_completed log_files={log_files}"
    );

    Ok(Some(DiagnosticsExport {
        path: destination.to_string_lossy().into_owned(),
        log_files,
    }))
}

fn write_bundle(
    destination: &Path,
    settings_path: &Path,
    log_dir: &Path,
    metadata: &BundleMetadata,
) -> Result<usize> {
    let logs = read_logs(log_dir);
    let temporary_path = temporary_archive_path(destination);
    let write_result = write_archive(
        &temporary_path,
        metadata,
        redacted_settings(settings_path),
        &logs,
    );

    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary_path);
        return Err(error);
    }

    if let Err(error) = replace_file(&temporary_path, destination) {
        let _ = fs::remove_file(&temporary_path);
        return Err(error.into());
    }

    Ok(logs.len())
}

fn write_archive(
    path: &Path,
    metadata: &BundleMetadata,
    settings: Value,
    logs: &[LogSnapshot],
) -> Result<()> {
    let file = create_private_file(path)?;
    let mut archive = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o600);

    write_json_entry(&mut archive, "manifest.json", metadata, options)?;
    write_json_entry(&mut archive, "settings.redacted.json", &settings, options)?;
    write_text_entry(&mut archive, "README.txt", README, options)?;

    for log in logs {
        let contents = if log.truncated {
            format!(
                "{}\n[truncated by diagnostics export]\n",
                log.contents.trim_end()
            )
        } else {
            log.contents.clone()
        };
        write_text_entry(
            &mut archive,
            &format!("logs/{}", log.name),
            &contents,
            options,
        )?;
    }

    archive.finish()?.sync_all()?;
    Ok(())
}

fn write_json_entry<T: Serialize>(
    archive: &mut ZipWriter<File>,
    name: &str,
    value: &T,
    options: SimpleFileOptions,
) -> Result<()> {
    let mut json = serde_json::to_vec_pretty(value)?;
    json.push(b'\n');
    archive.start_file(name, options)?;
    archive.write_all(&json)?;
    Ok(())
}

fn write_text_entry(
    archive: &mut ZipWriter<File>,
    name: &str,
    contents: &str,
    options: SimpleFileOptions,
) -> Result<()> {
    archive.start_file(name, options)?;
    archive.write_all(contents.as_bytes())?;
    Ok(())
}

fn read_logs(log_dir: &Path) -> Vec<LogSnapshot> {
    let Ok(entries) = fs::read_dir(log_dir) else {
        return Vec::new();
    };
    let mut paths = entries
        .filter_map(std::result::Result::ok)
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if !file_type.is_file() || !is_app_log(&name) {
                return None;
            }
            let modified = entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .unwrap_or(UNIX_EPOCH);
            Some((name, entry.path(), modified))
        })
        .collect::<Vec<_>>();
    paths.sort_by(|left, right| right.2.cmp(&left.2).then_with(|| right.0.cmp(&left.0)));
    paths.truncate(LOG_FILES_TO_KEEP);

    let mut remaining_bytes = MAX_EXPORTED_LOG_TOTAL_BYTES;
    let mut logs = Vec::new();
    for (_, path, _) in paths {
        if remaining_bytes == 0 {
            break;
        }
        let limit = remaining_bytes.min(MAX_EXPORTED_LOG_BYTES);
        if let Some((contents, truncated, bytes_read)) = read_log(&path, limit) {
            remaining_bytes -= bytes_read;
            logs.push(LogSnapshot {
                name: format!("support-{}.log", logs.len() + 1),
                contents,
                truncated,
            });
        }
    }
    logs
}

fn read_log(path: &Path, limit: u64) -> Option<(String, bool, u64)> {
    let file = open_log_file(path)?;
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes).ok()?;
    let truncated = bytes.len() as u64 > limit;
    bytes.truncate(limit as usize);
    let bytes_read = bytes.len() as u64;

    Some((
        redact_log(&String::from_utf8_lossy(&bytes)),
        truncated,
        bytes_read,
    ))
}

fn is_app_log(name: &str) -> bool {
    APP_LOG_FILE_NAME.is_match(name)
}

fn open_log_file(path: &Path) -> Option<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NOFOLLOW);
    let file = options.open(path).ok()?;
    file.metadata().ok()?.is_file().then_some(file)
}

fn redacted_settings(path: &Path) -> Value {
    let Ok(raw) = fs::read_to_string(path) else {
        return json!({
            "status": "not-available",
            "values": {}
        });
    };
    let Ok(Value::Object(stored)) = serde_json::from_str::<Value>(&raw) else {
        return json!({
            "status": "unreadable",
            "values": {}
        });
    };

    let mut values = Map::new();
    if let Some(theme @ ("system" | "light" | "dark")) = stored.get("theme").and_then(Value::as_str)
    {
        values.insert("theme".into(), json!(theme));
    }
    for key in ["analyticsEnabled", "crashReportingEnabled", "openAtLogin"] {
        if let Some(value) = stored.get(key).and_then(Value::as_bool) {
            values.insert(key.into(), json!(value));
        }
    }
    if let Some(open_at_launch @ ("last-session" | "ask" | "nothing")) =
        stored.get("openAtLaunch").and_then(Value::as_str)
    {
        values.insert("openAtLaunch".into(), json!(open_at_launch));
    }
    if let Some(overrides) = stored.get("shortcutOverrides").and_then(Value::as_object) {
        let valid_override_count = overrides.values().filter(|value| value.is_string()).count();
        values.insert("shortcutOverrideCount".into(), json!(valid_override_count));
    }
    json!({
        "status": "ok",
        "values": values
    })
}

fn redact_log(contents: &str) -> String {
    let redacted = PRIVATE_KEY.replace_all(contents, "[REDACTED PRIVATE KEY]");
    let redacted = KNOWN_TOKEN.replace_all(&redacted, "[REDACTED TOKEN]");
    let redacted = URI_CREDENTIALS.replace_all(&redacted, "${prefix}[REDACTED]@");
    let redacted = SECRET_HEADER.replace_all(&redacted, "${prefix}[REDACTED]");
    let redacted = BEARER_TOKEN.replace_all(&redacted, "${prefix}[REDACTED]");
    let redacted = JSON_SECRET.replace_all(&redacted, "${prefix}\"[REDACTED]\"");
    let redacted = ASSIGNED_SECRET.replace_all(&redacted, "${prefix}[REDACTED]");
    let redacted = EMAIL.replace_all(&redacted, "[REDACTED EMAIL]");
    let redacted = MAC_HOME.replace_all(&redacted, "${prefix}[REDACTED]");
    let redacted = UNIX_HOME.replace_all(&redacted, "${prefix}[REDACTED]");
    WINDOWS_HOME
        .replace_all(&redacted, "${prefix}[REDACTED]")
        .into_owned()
}

fn file_name_slug(name: &str) -> String {
    let slug = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();
    let slug = slug.trim_matches('-');
    if slug.is_empty() { "app" } else { slug }.to_owned()
}

fn temporary_archive_path(destination: &Path) -> PathBuf {
    let sequence = TEMP_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let file_name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("diagnostics.zip");
    destination.with_file_name(format!(
        ".{file_name}.{}.{}.tmp",
        std::process::id(),
        sequence
    ))
}

fn create_private_file(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    options.open(path)
}

#[cfg(not(target_os = "windows"))]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(target_os = "windows")]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    if destination.exists() {
        fs::remove_file(destination)?;
    }
    fs::rename(source, destination)
}

fn unix_time() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn settings_snapshot_is_allowlisted() {
        let directory = test_directory("settings");
        fs::create_dir_all(&directory).unwrap();
        let settings_path = directory.join("settings.json");
        fs::write(
            &settings_path,
            r#"{
              "theme": "dark",
              "openAtLogin": true,
              "shortcutOverrides": { "open": "must-not-leak-either" },
              "apiKey": "must-not-leak",
              "futureSecret": { "token": "also-private" }
            }"#,
        )
        .unwrap();

        let snapshot = redacted_settings(&settings_path);
        let serialized = serde_json::to_string(&snapshot).unwrap();
        assert!(serialized.contains("\"theme\":\"dark\""));
        assert!(serialized.contains("\"openAtLogin\":true"));
        assert!(serialized.contains("\"shortcutOverrideCount\":1"));
        assert!(!serialized.contains("must-not-leak"));
        assert!(!serialized.contains("must-not-leak-either"));
        assert!(!serialized.contains("also-private"));
        assert!(!serialized.contains("apiKey"));

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn log_redaction_removes_common_secrets_and_personal_data() {
        let source = "\
Authorization: Bearer abcdefghijklmnop
[2026-09-16][support][INFO] Authorization: Basic dXNlcjpwYXNz
Cookie: session=private-cookie
api_key=plain-secret
client_secret=client-private
AWS_SECRET_ACCESS_KEY=aws-private
{\"token\":\"json-secret\"}
sk-live-abcdefghijk
sk_live_abcdefghijk
postgres://person:database-password@example.invalid/db
person@example.com
/Users/kevin/Projects/example
/home/kevin/Documents/example
C:\\Users\\Kevin\\Documents\\example
-----BEGIN PRIVATE KEY-----
private-material
-----END PRIVATE KEY-----
";
        let redacted = redact_log(source);

        for secret in [
            "abcdefghijklmnop",
            "dXNlcjpwYXNz",
            "private-cookie",
            "plain-secret",
            "client-private",
            "aws-private",
            "json-secret",
            "sk-live-abcdefghijk",
            "sk_live_abcdefghijk",
            "database-password",
            "person@example.com",
            "Projects/example",
            "Documents/example",
            "Documents\\example",
            "private-material",
        ] {
            assert!(!redacted.contains(secret), "{secret} was not redacted");
        }
    }

    #[test]
    fn bundle_contains_scrubbed_logs_and_settings() {
        let directory = test_directory("bundle");
        let log_dir = directory.join("logs");
        fs::create_dir_all(&log_dir).unwrap();
        let settings_path = directory.join("settings.json");
        fs::write(
            &settings_path,
            r#"{"theme":"system","password":"settings-secret"}"#,
        )
        .unwrap();
        fs::write(log_dir.join("lampcircle.log"), "started token=log-secret\n").unwrap();
        fs::write(log_dir.join("unrelated.log"), "do-not-include").unwrap();

        let destination = directory.join("diagnostics.zip");
        let metadata = BundleMetadata {
            schema_version: 1,
            generated_at_unix_seconds: 1,
            app_name: "Lamp Circle".into(),
            app_version: "0.0.1".into(),
            app_identifier: "app.truefrontier.lampcircle".into(),
            os: "macos",
            arch: "aarch64",
        };
        assert_eq!(
            write_bundle(&destination, &settings_path, &log_dir, &metadata).unwrap(),
            1
        );

        let file = File::open(&destination).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let mut settings = String::new();
        archive
            .by_name("settings.redacted.json")
            .unwrap()
            .read_to_string(&mut settings)
            .unwrap();
        assert!(settings.contains("\"theme\": \"system\""));
        assert!(!settings.contains("settings-secret"));

        let mut log = String::new();
        archive
            .by_name("logs/support-1.log")
            .unwrap()
            .read_to_string(&mut log)
            .unwrap();
        assert!(!log.contains("log-secret"));
        assert!(archive.by_name("logs/unrelated.log").is_err());

        drop(archive);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn log_selection_is_strict_and_bounded() {
        let directory = test_directory("log-selection");
        fs::create_dir_all(&directory).unwrap();
        for name in [
            "lampcircle.log",
            "lampcircle_2026-09-16_10-00-00.log",
            "lampcircle_2026-09-16_11-00-00.log",
            "lampcircle_2026-09-16_12-00-00.log",
            "lampcircle_2026-09-16_13-00-00.log",
            "lampcircle_unsafe.log",
            "lampcircle_2026-09-16_13-00-00.log\\..\\secret",
        ] {
            fs::write(directory.join(name), vec![b'x'; 1_100_000]).unwrap();
        }

        let logs = read_logs(&directory);
        assert_eq!(logs.len(), LOG_FILES_TO_KEEP);
        assert!(
            logs.iter().map(|log| log.contents.len()).sum::<usize>()
                <= MAX_EXPORTED_LOG_TOTAL_BYTES as usize
        );
        assert!(logs
            .iter()
            .enumerate()
            .all(|(index, log)| log.name == format!("support-{}.log", index + 1)));

        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn log_reader_refuses_symlinks() {
        use std::os::unix::fs::symlink;

        let directory = test_directory("symlink");
        fs::create_dir_all(&directory).unwrap();
        let secret = directory.join("secret.txt");
        let link = directory.join("lampcircle.log");
        fs::write(&secret, "must-not-read").unwrap();
        symlink(&secret, &link).unwrap();

        assert!(open_log_file(&link).is_none());
        assert!(read_logs(&directory).is_empty());

        fs::remove_dir_all(directory).unwrap();
    }

    fn test_directory(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "lampcircle-diagnostics-{label}-{}-{}",
            std::process::id(),
            TEMP_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ))
    }
}
