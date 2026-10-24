//! The iPhone and iPad side: the audio session, keeping the screen on, songs from the Files app,
//! and a debug-only seed for simulator screenshots. Library and Perform call these only on iOS.

use serde::Serialize;
use tauri::ipc::Response;
use tauri::AppHandle;
#[cfg(target_os = "ios")]
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use crate::error::{AppError, Result};

/// What Library adds: recordings, and the .djw maps that go with them.
const IMPORT_TYPES: &[&str] = &["mp3", "m4a", "aac", "wav", "aif", "aiff", "caf", "flac", "djw"];

#[derive(Serialize)]
struct Header {
    #[serde(skip_serializing_if = "Option::is_none")]
    route: Option<String>,
    files: Vec<Entry>,
}

#[derive(Serialize)]
struct Entry {
    name: String,
    size: usize,
}

/// Files for the page in one binary body, since JSON would spell out every byte as a number:
/// the header's length as a little-endian u32, the JSON header, then each file's bytes in header order.
/// `unpack` in src/platform/tauri.ts reads it.
fn framed(route: Option<String>, files: Vec<(String, Vec<u8>)>) -> Result<Response> {
    let header = serde_json::to_vec(&Header {
        route,
        files: files
            .iter()
            .map(|(name, bytes)| Entry { name: name.clone(), size: bytes.len() })
            .collect(),
    })?;
    let size = files.iter().map(|(_, bytes)| bytes.len()).sum::<usize>();
    let mut body = Vec::with_capacity(4 + header.len() + size);
    body.extend_from_slice(&(header.len() as u32).to_le_bytes());
    body.extend_from_slice(&header);
    for (_, bytes) in files {
        body.extend_from_slice(&bytes);
    }
    Ok(Response::new(body))
}

/// Opens the Files picker for recordings and .djw maps, several at once. No files when the person cancels.
// ponytail: every picked file is in memory twice on its way to the page; hand over paths instead if people import whole albums.
#[tauri::command]
pub async fn pick_import_files(app: AppHandle) -> Result<Response> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Audio or .djw", IMPORT_TYPES)
        .blocking_pick_files()
        .unwrap_or_default();
    let mut files = Vec::with_capacity(picked.len());
    for file in picked {
        let path = file
            .into_path()
            .map_err(|_| AppError::Message("Pick a file on this device.".into()))?;
        let name = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
        files.push((name, std::fs::read(&path)?));
        // iOS hands over copies in the app's temporary folder. Anywhere else this is the person's own file.
        #[cfg(target_os = "ios")]
        let _ = std::fs::remove_file(&path);
    }
    framed(None, files)
}

/// Keeps the screen on while Perform is open, so the phone never locks mid-song. Nothing to do on the Mac.
#[tauri::command]
pub fn set_keep_awake(app: AppHandle, enabled: bool) -> Result<()> {
    #[cfg(target_os = "ios")]
    app.run_on_main_thread(move || {
        if let Some(mtm) = objc2::MainThreadMarker::new() {
            objc2_ui_kit::UIApplication::sharedApplication(mtm).setIdleTimerDisabled(enabled);
        }
    })?;
    #[cfg(not(target_os = "ios"))]
    let _ = (app, enabled);
    Ok(())
}

/// Debug builds only: hands over every file in <app data>/dev-seed once, for simulator screenshots,
/// then renames the folder dev-seed.done. A route.txt there saying `tap` or `perform` comes back as the route.
#[cfg(all(debug_assertions, target_os = "ios"))]
#[tauri::command]
pub async fn take_dev_seed(app: AppHandle) -> Result<Response> {
    let folder = app.path().app_data_dir()?.join("dev-seed");
    if !folder.is_dir() {
        log::info!("No dev seed at {}", folder.display());
        return framed(None, Vec::new());
    }
    let mut route = None;
    let mut files = Vec::new();
    for entry in std::fs::read_dir(&folder)? {
        let path = entry?.path();
        let name = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
        if !path.is_file() || name.starts_with('.') {
            continue;
        }
        if name == "route.txt" {
            route = Some(std::fs::read_to_string(&path)?.trim().to_owned());
        } else {
            files.push((name, std::fs::read(&path)?));
        }
    }
    // By name, so the seed set plays in file-name order.
    files.sort_by(|a, b| a.0.cmp(&b.0));
    let done = folder.with_file_name("dev-seed.done");
    let _ = std::fs::remove_dir_all(&done);
    std::fs::rename(&folder, &done)?;
    framed(route, files)
}

/// Playback keeps the music going with the ring/silent switch on, and, with UIBackgroundModes audio,
/// when the screen locks. The page pads itself with env(safe-area-inset-*), so the web view must not inset it too.
#[cfg(target_os = "ios")]
pub fn setup(app: &tauri::App) {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::msg_send;
    use objc2_avf_audio::{AVAudioSession, AVAudioSessionCategoryPlayback};
    use objc2_ui_kit::{UIScrollView, UIScrollViewContentInsetAdjustmentBehavior};

    // SAFETY: the shared session and Apple's category constant, used as documented.
    unsafe {
        let session = AVAudioSession::sharedInstance();
        let started = match AVAudioSessionCategoryPlayback {
            Some(playback) => session.setCategory_error(playback).and_then(|()| session.setActive_error(true)),
            None => Ok(()),
        };
        if let Err(error) = started {
            log::warn!("Could not start the audio session: {error:?}");
        }
    }

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let insets = window.with_webview(|webview| {
        // SAFETY: on iOS `inner` is the WKWebView, and with_webview runs this on the main thread.
        unsafe {
            let wk_webview = &*webview.inner().cast::<AnyObject>();
            let scroll: Option<Retained<UIScrollView>> = msg_send![wk_webview, scrollView];
            if let Some(scroll) = scroll {
                scroll.setContentInsetAdjustmentBehavior(UIScrollViewContentInsetAdjustmentBehavior::Never);
            }
        }
    });
    if let Err(error) = insets {
        log::warn!("Could not hand the safe areas to the page: {error}");
    }
}
