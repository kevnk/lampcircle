//! YouTube captions for Find lyrics, fetched with yt-dlp beside the audio. Mirrors `writeCaptions` in `server/index.js`.
//!
//! yt-dlp names manual and auto captions alike (`<title> [<id>].en.json3`), so each kind gets its own call and its own
//! name: manual as `.subs.<lang>.<ext>`, auto as `.auto.<lang>.<ext>`.

use crate::error::{AppError, Result};
use regex::Regex;
use serde::Serialize;
use std::io::Read;
use std::path::Path;
use std::process::Child;
use std::time::{Duration, Instant};

/// yt-dlp flag, languages and file name marker per kind. Auto captions skip `en-en` and the like: those are the manual
/// track machine-translated, not auto timing.
pub const KINDS: [(&str, &str, &str); 2] = [("--write-subs", "en.*,-live_chat", "subs"), ("--write-auto-subs", "en-orig,en", "auto")];

#[derive(Debug, Serialize)]
pub struct Track {
    kind: &'static str,
    lang: String,
    ext: String,
    text: String,
}

/// A full YouTube link, the only kind with captions to fetch.
pub fn youtube(url: &str) -> Result<String> {
    let url = url.trim();
    let pattern = Regex::new(r"(?i)^https?://([a-z0-9-]+\.)*(youtube\.com|youtu\.be|youtube-nocookie\.com)(/|$)\S*$").expect("valid pattern");
    if pattern.is_match(url) {
        Ok(url.to_owned())
    } else {
        Err(AppError::Message("Captions come from YouTube links only.".into()))
    }
}

/// Waits for yt-dlp up to `limit`, then kills it. An error carries the last line it printed to stderr.
pub fn finish(mut child: Child, limit: Duration) -> Result<()> {
    // Drained on its own thread, so a full pipe can't stall yt-dlp and a pipe left open can't stall this.
    let (sender, stderr) = std::sync::mpsc::channel();
    if let Some(mut pipe) = child.stderr.take() {
        std::thread::spawn(move || {
            let mut text = String::new();
            let _ = pipe.read_to_string(&mut text);
            let _ = sender.send(text);
        });
    }
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if started.elapsed() > limit {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::Message(format!("yt-dlp took over {} s", limit.as_secs())));
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    if status.success() {
        return Ok(());
    }
    let errors = stderr.recv_timeout(Duration::from_secs(1)).unwrap_or_default();
    Err(AppError::Message(
        errors.lines().rev().find(|line| !line.trim().is_empty()).unwrap_or("yt-dlp failed").to_owned(),
    ))
}

/// Caption files directly in `dir`, only those for `stem` (an audio file's name without its extension) when given.
pub fn read(dir: &Path, stem: Option<&str>) -> Vec<Track> {
    let pattern = Regex::new(r"^(.*)\.(subs|auto)\.([A-Za-z0-9-]+)\.(json3|vtt)$").expect("valid pattern");
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            // Not symlinks: only files yt-dlp wrote here.
            if !entry.file_type().ok()?.is_file() {
                return None;
            }
            let name = entry.file_name().into_string().ok()?;
            let parts = pattern.captures(&name)?;
            if stem.is_some_and(|stem| stem != &parts[1]) {
                return None;
            }
            Some(Track {
                kind: if &parts[2] == "subs" { "manual" } else { "auto" },
                lang: parts[3].to_owned(),
                ext: parts[4].to_owned(),
                text: std::fs::read_to_string(entry.path()).ok()?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_youtube_links_only() {
        assert!(youtube(" https://www.youtube.com/watch?v=djrY_eFDOwE ").is_ok());
        assert!(youtube("https://youtu.be/djrY_eFDOwE").is_ok());
        assert!(youtube("https://youtube.com.evil.example/x").is_err());
        assert!(youtube("https://evil.example/youtube.com/").is_err());
        assert!(youtube("--exec=sh https://youtu.be/x").is_err());
    }

    #[test]
    fn reads_manual_and_auto_files_for_a_song() {
        let dir = std::env::temp_dir().join(format!("lampcircle-captions-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for name in ["Song [abc].subs.en.json3", "Song [abc].auto.en-orig.json3", "Other [xyz].auto.en.vtt", "Song [abc].mp3"] {
            std::fs::write(dir.join(name), name).unwrap();
        }
        let mut tracks = read(&dir, Some("Song [abc]"));
        tracks.sort_by(|a, b| a.kind.cmp(b.kind));
        let shown: Vec<_> = tracks.iter().map(|track| (track.kind, track.lang.as_str(), track.ext.as_str())).collect();
        assert_eq!(shown, [("auto", "en-orig", "json3"), ("manual", "en", "json3")]);
        assert_eq!(read(&dir, None).len(), 3);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
