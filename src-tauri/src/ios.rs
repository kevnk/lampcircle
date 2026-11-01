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
const IMPORT_TYPES: &[&str] = &[
    "mp3", "m4a", "aac", "wav", "aif", "aiff", "caf", "flac", "djw",
];

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
fn frame(route: Option<String>, files: Vec<(String, Vec<u8>)>) -> Result<Vec<u8>> {
    let header = serde_json::to_vec(&Header {
        route,
        files: files
            .iter()
            .map(|(name, bytes)| Entry {
                name: name.clone(),
                size: bytes.len(),
            })
            .collect(),
    })?;
    let size = files.iter().map(|(_, bytes)| bytes.len()).sum::<usize>();
    let mut body = Vec::with_capacity(4 + header.len() + size);
    body.extend_from_slice(&(header.len() as u32).to_le_bytes());
    body.extend_from_slice(&header);
    for (_, bytes) in files {
        body.extend_from_slice(&bytes);
    }
    Ok(body)
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
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        files.push((name, std::fs::read(&path)?));
        // iOS hands over copies in the app's temporary folder. Anywhere else this is the person's own file.
        #[cfg(target_os = "ios")]
        let _ = std::fs::remove_file(&path);
    }
    Ok(Response::new(frame(None, files)?))
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
        return Ok(Response::new(frame(None, Vec::new())?));
    }
    let mut route = None;
    let mut files = Vec::new();
    for entry in std::fs::read_dir(&folder)? {
        let path = entry?.path();
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
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
    Ok(Response::new(frame(route, files)?))
}

/// The audio session. Until Lamp Circle plays it is Ambient and inactive, so other apps' music plays on, even
/// after the first tap wakes the page's audio. While it plays it leads: Playback stops other apps' music and
/// keeps going with the ring/silent switch on and, with UIBackgroundModes audio, when the screen locks.
#[cfg(target_os = "ios")]
mod audio_session {
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject};
    use objc2::{class, define_class, msg_send, sel, AnyThread, DefinedClass};
    use objc2_avf_audio::{
        AVAudioSession, AVAudioSessionCategoryAmbient, AVAudioSessionCategoryPlayback,
        AVAudioSessionInterruptionNotification, AVAudioSessionInterruptionType,
        AVAudioSessionInterruptionTypeKey, AVAudioSessionRouteChangeNotification,
        AVAudioSessionRouteChangeReason, AVAudioSessionRouteChangeReasonKey,
        AVAudioSessionSetActiveOptions,
    };
    use tauri::{AppHandle, Emitter, Listener};

    fn set_playing(playing: bool) {
        // SAFETY: the shared session and Apple's category constants, used as documented.
        let changed = unsafe {
            let session = AVAudioSession::sharedInstance();
            if playing {
                match AVAudioSessionCategoryPlayback {
                    Some(playback) => session
                        .setCategory_error(playback)
                        .and_then(|()| session.setActive_error(true)),
                    None => Ok(()),
                }
            } else {
                // iOS deactivates even when this reports audio still running, so the category changes either way.
                let inactive = session.setActive_withOptions_error(
                    false,
                    AVAudioSessionSetActiveOptions::NotifyOthersOnDeactivation,
                );
                let ambient = match AVAudioSessionCategoryAmbient {
                    Some(ambient) => session.setCategory_error(ambient),
                    None => Ok(()),
                };
                inactive.and(ambient)
            }
        };
        if let Err(error) = changed {
            log::warn!("Could not change the audio session: {error:?}");
        }
    }

    /// A number in a notification's userInfo.
    ///
    /// # Safety
    /// `note` must be an NSNotification.
    unsafe fn info_number(note: &AnyObject, key: Option<&AnyObject>) -> Option<usize> {
        let info: Option<Retained<AnyObject>> = msg_send![note, userInfo];
        let number: Option<Retained<AnyObject>> = msg_send![&*info?, objectForKey: key?];
        Some(msg_send![&*number?, unsignedIntegerValue])
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "LampCircleAudioObserver"]
        #[ivars = AppHandle]
        struct Observer;

        impl Observer {
            /// The page pauses when a call starts and stays paused when it ends, whatever iOS suggests:
            /// music coming back by itself after a call is the worse surprise in a live set.
            /// Only the page can tell a call from WebKit's own session starting, so it decides.
            #[unsafe(method(interrupted:))]
            fn interrupted(&self, note: &AnyObject) {
                // SAFETY: NSNotificationCenter passes an NSNotification, and this is Apple's key.
                let kind = unsafe {
                    info_number(note, AVAudioSessionInterruptionTypeKey.map(|key| &***key))
                };
                if kind == Some(AVAudioSessionInterruptionType::Began.0) {
                    self.tell_page("audio-interrupted");
                }
            }

            /// The headphones or the cable to the sound desk came out. Music must not jump to the phone's speaker.
            #[unsafe(method(routeChanged:))]
            fn route_changed(&self, note: &AnyObject) {
                // SAFETY: NSNotificationCenter passes an NSNotification, and this is Apple's key.
                let reason = unsafe {
                    info_number(note, AVAudioSessionRouteChangeReasonKey.map(|key| &***key))
                };
                if reason == Some(AVAudioSessionRouteChangeReason::OldDeviceUnavailable.0) {
                    self.tell_page("audio-pause");
                }
            }
        }
    );

    impl Observer {
        fn tell_page(&self, event: &str) {
            if let Err(error) = self.ivars().emit_to("main", event, ()) {
                log::warn!("Could not send {event} to the page: {error}");
            }
        }
    }

    pub fn start(app: &tauri::App) {
        // The page's emit is an async command, so activating blocks a worker and not the main thread.
        // Its promise settles after this returns, which lets the page wait for the session before starting audio.
        app.listen("audio-playing", |event| {
            objc2::rc::autoreleasepool(|_| set_playing(event.payload() == "true"));
        });

        let observer = Observer::alloc().set_ivars(app.handle().clone());
        // SAFETY: NSObject's init, and NSNotificationCenter's own selectors with arguments of the types it takes.
        unsafe {
            let observer: Retained<Observer> = msg_send![super(observer), init];
            let center: Retained<AnyObject> =
                msg_send![class!(NSNotificationCenter), defaultCenter];
            let session = AVAudioSession::sharedInstance();
            let _: () = msg_send![
                &center,
                addObserver: &*observer,
                selector: sel!(interrupted:),
                name: AVAudioSessionInterruptionNotification,
                object: &*session
            ];
            let _: () = msg_send![
                &center,
                addObserver: &*observer,
                selector: sel!(routeChanged:),
                name: AVAudioSessionRouteChangeNotification,
                object: &*session
            ];
            // The center does not keep it alive, and it listens for as long as the app runs.
            std::mem::forget(observer);
        }
    }
}

/// The page pads itself with env(safe-area-inset-*), so the web view must not inset it too.
#[cfg(target_os = "ios")]
pub fn setup(app: &tauri::App) {
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_ui_kit::{UIScrollView, UIScrollViewContentInsetAdjustmentBehavior};

    audio_session::start(app);

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let insets = window.with_webview(|webview| {
        // SAFETY: on iOS `inner` is the WKWebView, and with_webview runs this on the main thread.
        unsafe {
            let wk_webview = &*webview.inner().cast::<AnyObject>();
            let scroll: Option<Retained<UIScrollView>> = msg_send![wk_webview, scrollView];
            if let Some(scroll) = scroll {
                scroll.setContentInsetAdjustmentBehavior(
                    UIScrollViewContentInsetAdjustmentBehavior::Never,
                );
            }
        }
    });
    if let Err(error) = insets {
        log::warn!("Could not hand the safe areas to the page: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::frame;

    #[test]
    fn frames_the_header_then_each_file() {
        let body = frame(
            Some("tap".into()),
            vec![
                ("a.djw".into(), b"djw: 2".to_vec()),
                ("b.mp3".into(), vec![0, 255]),
            ],
        )
        .unwrap();
        let header =
            br#"{"route":"tap","files":[{"name":"a.djw","size":6},{"name":"b.mp3","size":2}]}"#;
        let mut expected = (header.len() as u32).to_le_bytes().to_vec();
        expected.extend_from_slice(header);
        expected.extend_from_slice(b"djw: 2");
        expected.extend_from_slice(&[0, 255]);
        assert_eq!(body, expected);
    }

    #[test]
    fn frames_no_route_and_no_files() {
        let body = frame(None, Vec::new()).unwrap();
        assert_eq!(&body[4..], br#"{"files":[]}"#);
    }
}
