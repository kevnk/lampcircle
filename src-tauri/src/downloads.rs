//! The download helper from `server/index.js`, as Tauri commands: a one-at-a-time yt-dlp queue
//! that saves mp3s in the app's library folder, plus the Save dialog for `.djw` maps.
//!
//! The web build still uses the Node helper. Keep the two in step: same job shape, same yt-dlp flags.

use crate::captions;
use crate::error::{AppError, Result};
use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;
#[cfg(any(desktop, target_os = "ios"))]
use tauri::Manager;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

const NOT_INSTALLED: &str =
    "yt-dlp is not installed. Install it with brew install yt-dlp ffmpeg, then reopen Lamp Circle.";

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    id: String,
    url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    artist: Option<String>,
    status: &'static str,
    percent: f64,
    eta: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    /// A .djw map waiting for this download's audio. The webview owns its shape.
    #[serde(skip_serializing_if = "Option::is_none")]
    map: Option<Value>,
}

#[derive(Serialize)]
pub struct Track {
    url: String,
    title: String,
}

#[derive(Default)]
struct Queue {
    jobs: Vec<Job>,
    busy: bool,
}

pub struct Downloads {
    library: PathBuf,
    yt_dlp: Option<PathBuf>,
    /// Finder starts apps with a bare PATH, so yt-dlp would miss Homebrew's ffmpeg and node.
    path: OsString,
    queue: Mutex<Queue>,
}

pub type Shared = Arc<Downloads>;

static NEXT_ID: AtomicU64 = AtomicU64::new(0);

impl Downloads {
    pub fn new(library: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&library)?;
        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
        let mut dirs = vec![
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
            home.join(".local/bin"),
        ];
        dirs.extend(std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()));
        let path = std::env::join_paths(&dirs).map_err(|error| AppError::Message(error.to_string()))?;
        let yt_dlp = std::env::var_os("YT_DLP_PATH")
            .map(PathBuf::from)
            .into_iter()
            .chain(dirs.iter().map(|dir| dir.join("yt-dlp")))
            .find(|bin| bin.is_file());
        Ok(Self {
            library: library.canonicalize()?,
            yt_dlp,
            path,
            queue: Mutex::default(),
        })
    }

    fn queue(&self) -> MutexGuard<'_, Queue> {
        self.queue.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn yt_dlp(&self) -> Result<Command> {
        let bin = self.yt_dlp.as_ref().ok_or_else(|| AppError::Message(NOT_INSTALLED.into()))?;
        let mut command = Command::new(bin);
        command.env("PATH", &self.path).stdin(Stdio::null());
        Ok(command)
    }

    fn update(&self, id: &str, change: impl FnOnce(&mut Job)) {
        if let Some(job) = self.queue().jobs.iter_mut().find(|job| job.id == id) {
            change(job);
        }
    }

    /// Starts the next queued job unless one is running. Each job runs on its own thread.
    fn next(self: &Arc<Self>) {
        let job = {
            let mut queue = self.queue();
            if queue.busy {
                return;
            }
            let Some(job) = queue.jobs.iter_mut().find(|job| job.status == "queued") else {
                return;
            };
            job.status = "downloading";
            let job = job.clone();
            queue.busy = true;
            job
        };
        let downloads = Arc::clone(self);
        std::thread::spawn(move || {
            let result = downloads.run(&job);
            let wants_captions = result.is_ok() && job.kind.as_deref() != Some("pad") && captions::youtube(&job.url).is_ok();
            {
                // One lock for both, so nobody sees a finished job while the queue still looks busy.
                let mut queue = downloads.queue();
                if let Some(job) = queue.jobs.iter_mut().find(|item| item.id == job.id) {
                    match result {
                        Ok(file_name) => {
                            job.status = "done";
                            job.percent = 100.0;
                            job.file_name = Some(file_name);
                        }
                        Err(error) => {
                            job.status = "error";
                            job.error = Some(error.to_string());
                        }
                    }
                }
                queue.busy = false;
            }
            downloads.next();
            // After the job is done and the next one started, so captions never hold up or fail a download.
            if wants_captions {
                downloads.write_captions(&job.url, &downloads.library, Duration::from_secs(60));
            }
        });
    }

    fn run(&self, job: &Job) -> Result<String> {
        let mut child = self
            .yt_dlp()?
            .args([
                "--no-playlist",
                "--no-warnings",
                "--no-simulate",
                "--newline",
                "--progress",
                "-x",
                "--audio-format",
                "mp3",
                "--print",
                "before_dl:META %(.{title,uploader,artist,track})j",
                "--print",
                "after_move:FILEPATH %(filepath)s",
                "--progress-template",
                "download:PROG %(progress)j",
                "-o",
                "%(title)s [%(id)s].%(ext)s",
                "-P",
            ])
            .arg(&self.library)
            .args(["--", &job.url])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        // Read stderr on its own thread, so a full pipe never stalls yt-dlp.
        let mut stderr = child.stderr.take().expect("stderr is piped");
        let errors = std::thread::scope(|scope| {
            let errors = scope.spawn(|| {
                let mut text = String::new();
                let mut chunk = [0u8; 4096];
                while let Ok(count) = stderr.read(&mut chunk) {
                    if count == 0 {
                        break;
                    }
                    let piece = String::from_utf8_lossy(&chunk[..count]);
                    if piece.contains("PP started") || piece.contains("ExtractAudio") {
                        self.update(&job.id, |job| job.status = "converting");
                    }
                    text.push_str(&piece);
                }
                text
            });
            let stdout = child.stdout.take().expect("stdout is piped");
            for line in BufReader::new(stdout).lines().map_while(std::io::Result::ok) {
                self.update(&job.id, |job| read(job, line.trim()));
            }
            errors.join().unwrap_or_default()
        });
        let status = child.wait()?;

        let file_path = self.queue().jobs.iter().find(|item| item.id == job.id).and_then(|job| job.file_path.clone());
        match file_path.and_then(|path| self.inside(Path::new(&path))) {
            Some(path) if status.success() => Ok(path.file_name().unwrap_or_default().to_string_lossy().into_owned()),
            _ => Err(AppError::Message(
                errors
                    .lines()
                    .rev()
                    .find(|line| !line.trim().is_empty())
                    .map(str::to_owned)
                    .unwrap_or_else(|| format!("yt-dlp exited with code {}", status.code().unwrap_or(-1))),
            )),
        }
    }

    /// Saves a YouTube video's English captions into `dir`. Failures are logged, never raised: captions are extra.
    fn write_captions(&self, url: &str, dir: &Path, limit: Duration) {
        for (flag, langs, kind) in captions::KINDS {
            let result = self.yt_dlp().and_then(|mut command| {
                command
                    .args(["--no-playlist", "--no-warnings", "--skip-download", flag, "--sub-langs", langs, "--sub-format", "json3/vtt"])
                    .args(["-o", &format!("subtitle:%(title)s [%(id)s].{kind}.%(ext)s"), "-P"])
                    .arg(dir)
                    .args(["--", url])
                    .stdout(Stdio::null())
                    .stderr(Stdio::piped());
                captions::finish(command.spawn()?, limit)
            });
            if let Err(error) = result {
                log::warn!("No {kind} captions for {url}: {error}");
            }
        }
    }

    /// The real path of an existing file directly inside the library, symlinks resolved.
    fn inside(&self, path: &Path) -> Option<PathBuf> {
        let path = path.canonicalize().ok()?;
        (path.parent() == Some(self.library.as_path()) && path.is_file()).then_some(path)
    }
}

/// Applies one line of yt-dlp's stdout, as printed by the templates in `run`.
fn read(job: &mut Job, line: &str) {
    if let Some(meta) = line.strip_prefix("META ") {
        if let Ok(meta) = serde_json::from_str::<Value>(meta) {
            let text = |key: &str| meta.get(key).and_then(Value::as_str).filter(|value| !value.is_empty()).map(str::to_owned);
            job.title = text("track").or_else(|| text("title")).or(job.title.take());
            job.artist = Some(text("artist").or_else(|| text("uploader")).unwrap_or_default());
        }
    } else if let Some(progress) = line.strip_prefix("PROG ") {
        if let Ok(progress) = serde_json::from_str::<Value>(progress) {
            if let Some(percent) = progress.get("_percent").and_then(Value::as_f64) {
                job.percent = (percent * 10.0).round() / 10.0;
            }
            job.eta = progress.get("eta").and_then(Value::as_f64);
            if progress.get("status").and_then(Value::as_str) == Some("finished") {
                job.status = "converting";
            }
        }
    } else if let Some(path) = line.strip_prefix("FILEPATH ") {
        job.file_path = Some(path.to_owned());
    }
}

fn link(url: &str) -> Result<String> {
    let url = url.trim();
    let pattern = Regex::new(r"(?i)^https?://\S+$").expect("valid pattern");
    if pattern.is_match(url) {
        Ok(url.to_owned())
    } else {
        Err(AppError::Message("Paste a full link that starts with https://".into()))
    }
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| AppError::Message(error.to_string()))?
}

#[tauri::command]
pub fn download_jobs(downloads: State<'_, Shared>) -> Vec<Job> {
    downloads.queue().jobs.clone()
}

#[tauri::command]
pub fn add_download(
    downloads: State<'_, Shared>,
    url: String,
    kind: Option<String>,
    map: Option<Value>,
    title: Option<String>,
) -> Result<Job> {
    let url = link(&url)?;
    let mut probe = downloads.yt_dlp()?;
    let job = Job {
        id: format!("{:x}-{}", std::process::id(), NEXT_ID.fetch_add(1, Ordering::Relaxed)),
        url,
        kind: kind.filter(|kind| kind == "pad" || kind == "song"),
        title: title.filter(|title| !title.is_empty()),
        map: map.filter(Value::is_object),
        status: "queued",
        ..Job::default()
    };
    downloads.queue().jobs.push(job.clone());

    // The title shows while the job waits. ponytail: no timeout, a hung probe only leaves the row untitled.
    let shared = Arc::clone(downloads.inner());
    let (id, url) = (job.id.clone(), job.url.clone());
    std::thread::spawn(move || {
        let output = probe
            .args(["--no-playlist", "--no-warnings", "--skip-download", "--print", "%(title)s", "--", &url])
            .stderr(Stdio::null())
            .output();
        if let Ok(output) = output {
            if !output.status.success() {
                return;
            }
            let title = String::from_utf8_lossy(&output.stdout).lines().next().unwrap_or_default().trim().to_owned();
            shared.update(&id, |job| {
                if job.title.is_none() && !title.is_empty() {
                    job.title = Some(title);
                }
            });
        }
    });

    downloads.next();
    Ok(job)
}

/// Tracks of a playlist or album, without downloading.
#[tauri::command]
pub async fn list_playlist(downloads: State<'_, Shared>, url: String) -> Result<Vec<Track>> {
    let url = link(&url)?;
    let mut command = downloads.yt_dlp()?;
    blocking(move || {
        let output = command
            .args(["--flat-playlist", "--no-warnings", "--print", "%(id)s\t%(title)s", "--", &url])
            .stderr(Stdio::null())
            .output()?;
        if !output.status.success() {
            return Err(AppError::Message("Could not read that playlist.".into()));
        }
        Ok(String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter(|line| !line.is_empty())
            .map(|line| {
                let (id, title) = line.split_once('\t').unwrap_or((line, ""));
                Track { url: format!("https://www.youtube.com/watch?v={id}"), title: title.to_owned() }
            })
            .collect())
    })
    .await
}

#[tauri::command]
pub fn remove_download(downloads: State<'_, Shared>, id: String) {
    downloads
        .queue()
        .jobs
        .retain(|job| job.id != id || job.status == "downloading" || job.status == "converting");
}

/// A downloaded file's bytes. Only names directly inside the library folder are served.
#[tauri::command]
pub async fn library_file(downloads: State<'_, Shared>, file_name: String) -> Result<tauri::ipc::Response> {
    let bad = || AppError::Message("Bad file name".into());
    if Path::new(&file_name).file_name().and_then(|name| name.to_str()) != Some(file_name.as_str()) {
        return Err(bad());
    }
    let path = downloads
        .inside(&downloads.library.join(&file_name))
        .ok_or_else(|| AppError::Message(format!("Could not read {file_name}.")))?;
    Ok(tauri::ipc::Response::new(blocking(move || Ok(std::fs::read(path)?)).await?))
}

/// A YouTube video's captions, fetched now into a scratch folder that is removed after. Empty when it has none.
#[tauri::command]
pub async fn fetch_captions(downloads: State<'_, Shared>, url: String) -> Result<Vec<captions::Track>> {
    let url = captions::youtube(&url)?;
    let downloads = Arc::clone(downloads.inner());
    blocking(move || {
        let dir = std::env::temp_dir().join(format!("lampcircle-captions-{}-{}", std::process::id(), NEXT_ID.fetch_add(1, Ordering::Relaxed)));
        std::fs::create_dir_all(&dir)?;
        downloads.write_captions(&url, &dir, Duration::from_secs(60));
        let tracks = captions::read(&dir, None);
        let _ = std::fs::remove_dir_all(&dir);
        Ok(tracks)
    })
    .await
}

/// Captions saved beside a downloaded song. `file_name` is its audio file, or a path to it.
#[tauri::command]
pub async fn saved_captions(downloads: State<'_, Shared>, file_name: String) -> Result<Vec<captions::Track>> {
    let stem = Path::new(&file_name).file_stem().and_then(|stem| stem.to_str()).unwrap_or_default().to_owned();
    let library = downloads.library.clone();
    blocking(move || Ok(if stem.is_empty() { Vec::new() } else { captions::read(&library, Some(&stem)) })).await
}

/// Asks where to save `text`, then writes it. False when the person cancels.
#[cfg(not(target_os = "ios"))]
#[tauri::command]
pub async fn save_text(app: AppHandle, file_name: String, text: String) -> Result<bool> {
    let mut dialog = app.dialog().file().set_file_name(&file_name);
    if let Some(extension) = Path::new(&file_name).extension().and_then(|extension| extension.to_str()) {
        dialog = dialog.add_filter(extension, &[extension]);
    }
    #[cfg(desktop)]
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    let Some(destination) = dialog.blocking_save_file() else {
        return Ok(false);
    };
    let destination = destination
        .into_path()
        .map_err(|_| AppError::Message("Pick a folder on this Mac.".into()))?;
    std::fs::write(destination, text)?;
    Ok(true)
}

/// iOS can only export a file that already exists: its save dialog sends out the file in Documents
/// with this name, so `text` goes there first. False when the person cancels.
#[cfg(target_os = "ios")]
#[tauri::command]
pub async fn save_text(app: AppHandle, file_name: String, text: String) -> Result<bool> {
    let staged = app.path().document_dir()?.join(&file_name);
    std::fs::write(&staged, text)?;
    let saved = app.dialog().file().set_file_name(&file_name).blocking_save_file().is_some();
    let _ = std::fs::remove_file(&staged);
    Ok(saved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn reads_yt_dlp_lines() {
        let mut job = Job { title: Some("Probe title".into()), ..Job::default() };
        read(&mut job, r#"META {"title":"Leeland - Way Maker","uploader":"Leeland VEVO","artist":null,"track":null}"#);
        read(&mut job, r#"PROG {"status":"downloading","_percent":31.46,"eta":12}"#);
        assert_eq!(job.title.as_deref(), Some("Leeland - Way Maker"));
        assert_eq!(job.artist.as_deref(), Some("Leeland VEVO"));
        assert_eq!((job.percent, job.eta), (31.5, Some(12.0)));
        read(&mut job, r#"PROG {"status":"finished","_percent":100,"eta":null}"#);
        read(&mut job, "PROG {partial");
        read(&mut job, "FILEPATH /tmp/Way Maker [abc].mp3");
        assert_eq!((job.status, job.eta), ("converting", None));
        assert_eq!(job.file_path.as_deref(), Some("/tmp/Way Maker [abc].mp3"));
    }

    #[test]
    fn needs_a_full_link() {
        assert!(link(" https://youtu.be/x ").is_ok());
        assert!(link("youtu.be/x").is_err());
        assert!(link("https://a b").is_err());
    }

    /// Runs the queue against the fake yt-dlp the e2e suite uses, with two .djw imports added back to back.
    #[test]
    fn downloads_with_the_e2e_fake() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let work = std::env::temp_dir().join(format!("lampcircle-downloads-{}", std::process::id()));
        let library = work.join("library");
        std::fs::create_dir_all(&library).unwrap();
        std::fs::write(work.join("song-a.wav"), b"RIFF fake").unwrap();
        std::fs::write(work.join("song-b.wav"), b"RIFF fake").unwrap();
        std::fs::write(work.join("outside.mp3"), b"secret").unwrap();
        std::env::set_var("YT_DLP_PATH", root.join("scripts/fake-yt-dlp.mjs"));
        std::env::set_var("FAKE_YTDLP_FIXTURES", &work);
        let downloads = Arc::new(Downloads::new(library.clone()).unwrap());

        for (id, url) in [("a", "https://www.youtube.com/watch?v=morning"), ("b", "https://www.youtube.com/watch?v=evening")] {
            downloads.queue().jobs.push(Job {
                id: id.into(),
                url: url.into(),
                map: Some(serde_json::json!({ "title": id })),
                status: "queued",
                ..Job::default()
            });
            downloads.next();
        }
        assert_eq!(downloads.queue().jobs[1].status, "queued", "the second waits its turn");
        let started = Instant::now();
        let jobs = loop {
            let jobs = downloads.queue().jobs.clone();
            if jobs.iter().all(|job| job.status == "done" || job.status == "error") || started.elapsed() > Duration::from_secs(30) {
                break jobs;
            }
            std::thread::sleep(Duration::from_millis(50));
        };
        let (job, second) = (jobs[0].clone(), &jobs[1]);
        assert_eq!(job.status, "done", "{:?}", job.error);
        assert_eq!(second.status, "done", "{:?}", second.error);
        assert_eq!(second.file_name.as_deref(), Some("Evening Test [tchvevening].mp3"));
        assert_eq!(jobs.iter().map(|job| job.map.clone()).collect::<Vec<_>>(), [Some(serde_json::json!({ "title": "a" })), Some(serde_json::json!({ "title": "b" }))]);
        assert_eq!(job.title.as_deref(), Some("Test Band - Morning Test (Official Video)"));
        assert_eq!(job.file_name.as_deref(), Some("Test Band - Morning Test (Official Video) [tchvmorning].mp3"));
        assert!(downloads.inside(&library.join(job.file_name.unwrap())).is_some());
        assert!(downloads.inside(&library.join("../outside.mp3")).is_none());
        assert!(!downloads.queue().busy);
        std::fs::remove_dir_all(work).unwrap();
    }
}
