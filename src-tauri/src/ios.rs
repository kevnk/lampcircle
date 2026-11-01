//! The iPhone and iPad side: the audio session, keeping the screen on, haptics, songs from the Files app,
//! and a debug-only seed for simulator screenshots. Library and Perform call these only on iOS, apart from
//! keeping the screen on, which Perform also does on the Mac.

use serde::{Deserialize, Serialize};
#[cfg(any(test, target_os = "ios"))]
use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicUsize, Ordering},
};
use tauri::ipc::Response;
use tauri::AppHandle;
#[cfg(target_os = "ios")]
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use crate::error::{AppError, Result};

#[cfg(any(test, target_os = "ios"))]
mod backup;

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

/// Keeps the screen on during Perform, so the phone never locks mid-song and a Mac's display, with the words on the
/// second screen, never sleeps through a long song.
#[tauri::command]
pub fn set_keep_awake(app: AppHandle, enabled: bool) -> Result<()> {
    #[cfg(target_os = "ios")]
    app.run_on_main_thread(move || {
        if let Some(mtm) = objc2::MainThreadMarker::new() {
            objc2_ui_kit::UIApplication::sharedApplication(mtm).setIdleTimerDisabled(enabled);
        }
    })?;
    #[cfg(not(target_os = "ios"))]
    let _ = app;
    #[cfg(target_os = "macos")]
    hold_mac_awake(enabled);
    #[cfg(not(any(target_os = "ios", target_os = "macos")))]
    let _ = enabled;
    Ok(())
}

/// One caffeinate at most. `-w` ends it with this app, even after a crash, so it can't keep the Mac awake for good.
#[cfg(target_os = "macos")]
fn hold_mac_awake(enabled: bool) {
    use std::process::{Child, Command};
    use std::sync::Mutex;

    static HOLD: Mutex<Option<Child>> = Mutex::new(None);
    let mut hold = HOLD.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(mut held) = hold.take() {
        let _ = held.kill();
        let _ = held.wait();
    }
    if enabled {
        let pid = std::process::id().to_string();
        *hold = Command::new("/usr/bin/caffeinate")
            .args(["-d", "-i", "-w", &pid])
            .spawn()
            .inspect_err(|error| log::warn!("Could not keep the display on: {error}"))
            .ok();
    }
}

/// What the page asks the Taptic Engine for. The names match HapticKind in src/lib/haptics.ts.
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Haptic {
    /// Wakes the engine for a landing about to come, so its tick is on time.
    Prepare,
    Landing,
    Selection,
}

/// A tick, if the app is in front. Nothing to do on the Mac.
#[tauri::command]
pub fn haptic(app: AppHandle, kind: Haptic) -> Result<()> {
    #[cfg(target_os = "ios")]
    app.run_on_main_thread(move || {
        if let Some(mtm) = objc2::MainThreadMarker::new() {
            haptics::play(mtm, kind);
        }
    })?;
    #[cfg(not(target_os = "ios"))]
    let _ = (app, kind);
    Ok(())
}

#[cfg(target_os = "ios")]
mod haptics {
    use std::cell::OnceCell;

    use objc2::rc::Retained;
    use objc2::{MainThreadMarker, MainThreadOnly};
    use objc2_ui_kit::{
        UIApplication, UIApplicationState, UIImpactFeedbackGenerator, UIImpactFeedbackStyle,
        UISelectionFeedbackGenerator,
    };

    use super::Haptic;

    // They stay for the app's life, on the main thread: preparing only helps the generator that then plays.
    thread_local! {
        static LANDING: OnceCell<Retained<UIImpactFeedbackGenerator>> = const { OnceCell::new() };
        static SELECTION: OnceCell<Retained<UISelectionFeedbackGenerator>> = const { OnceCell::new() };
    }

    pub fn play(mtm: MainThreadMarker, kind: Haptic) {
        // WebKit can be late to say the app has left the front, so ask iOS itself.
        if UIApplication::sharedApplication(mtm).applicationState() != UIApplicationState::Active {
            return;
        }
        // The newer way to choose a style needs iOS 17.5, and the app runs from iOS 16.
        #[allow(deprecated)]
        let light = || {
            UIImpactFeedbackGenerator::initWithStyle(
                UIImpactFeedbackGenerator::alloc(mtm),
                UIImpactFeedbackStyle::Light,
            )
        };
        match kind {
            Haptic::Prepare => LANDING.with(|cell| cell.get_or_init(light).prepare()),
            Haptic::Landing => LANDING.with(|cell| cell.get_or_init(light).impactOccurred()),
            Haptic::Selection => SELECTION.with(|cell| {
                cell.get_or_init(|| UISelectionFeedbackGenerator::new(mtm))
                    .selectionChanged()
            }),
        }
    }
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

/// Moves the .djw files in `inbox` to `to`, once each, and says where they went. No inbox means no files.
/// Each gets a folder of its own, so a second file with the same name cannot replace one the page has not read yet.
#[cfg(any(test, target_os = "ios"))]
fn take_from_inbox(inbox: &Path, to: &Path) -> Vec<PathBuf> {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let Ok(entries) = std::fs::read_dir(inbox) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("djw"))
        })
        .filter_map(|path| {
            let folder = to.join(format!("opened-{}", NEXT.fetch_add(1, Ordering::Relaxed)));
            let moved = folder.join(path.file_name()?);
            std::fs::create_dir_all(&folder)
                .and_then(|()| std::fs::rename(&path, &moved))
                .map_err(|error| {
                    log::warn!("Could not take {} from the inbox: {error}", path.display())
                })
                .ok()?;
            Some(moved)
        })
        .collect()
}

/// Hands the page any .djw iOS has copied to Documents/Inbox, from the Files app, AirDrop or a share sheet.
/// The folder is the only reliable list: tao drops the URL of a scene that is connecting, which is every cold launch.
/// True when it found one. `take_opened_files` reads them, and iOS clears the temporary folder in time.
#[cfg(target_os = "ios")]
fn collect_inbox(app: &AppHandle) -> bool {
    let Ok(documents) = app.path().document_dir() else {
        return false;
    };
    let files = take_from_inbox(&documents.join("Inbox"), &std::env::temp_dir());
    let found = !files.is_empty();
    app.state::<crate::OpenedFiles>()
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .extend(files);
    found
}

/// Looks in the inbox now, for a launch that opened a file, and whenever the app comes to the front or is told
/// to open one. A plugin added here can see those events, so this stays out of the app's own run loop.
#[cfg(target_os = "ios")]
fn watch_inbox(app: &tauri::App) {
    use tauri::{Emitter, RunEvent, WindowEvent};

    collect_inbox(app.handle());
    let watcher = tauri::plugin::Builder::<tauri::Wry>::new("djw-inbox")
        .on_event(|app, event| {
            let look = matches!(
                event,
                RunEvent::Opened { .. }
                    | RunEvent::WindowEvent {
                        event: WindowEvent::Focused(true),
                        ..
                    }
            );
            if look && collect_inbox(app) {
                let _ = app.emit_to("main", "files-opened", ());
            }
        })
        .build();
    if let Err(error) = app.handle().plugin(watcher) {
        log::warn!("Could not watch for opened files: {error}");
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
    watch_inbox(app);
    backup::start(app);

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
    use super::{frame, take_from_inbox, Haptic};

    #[test]
    fn reads_the_names_the_page_sends() {
        let read = serde_json::from_str::<Haptic>;
        assert!(matches!(read(r#""prepare""#), Ok(Haptic::Prepare)));
        assert!(matches!(read(r#""landing""#), Ok(Haptic::Landing)));
        assert!(matches!(read(r#""selection""#), Ok(Haptic::Selection)));
        assert!(read(r#""buzz""#).is_err());
    }

    #[test]
    fn takes_each_djw_from_the_inbox_once() {
        let root = std::env::temp_dir().join(format!("lampcircle-inbox-{}", std::process::id()));
        let inbox = root.join("Inbox");
        let to = root.join("to");
        std::fs::create_dir_all(&inbox).unwrap();
        std::fs::create_dir_all(&to).unwrap();
        std::fs::write(inbox.join("Way Maker.DJW"), "djw: 2").unwrap();
        std::fs::write(inbox.join("notes.txt"), "not a map").unwrap();

        let first = take_from_inbox(&inbox, &to);
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].file_name().unwrap(), "Way Maker.DJW");
        assert!(inbox.join("notes.txt").exists());
        assert!(take_from_inbox(&inbox, &to).is_empty());

        std::fs::write(inbox.join("Way Maker.DJW"), "a second file").unwrap();
        let second = take_from_inbox(&inbox, &to);
        assert_eq!(std::fs::read_to_string(&first[0]).unwrap(), "djw: 2");
        assert_eq!(
            std::fs::read_to_string(&second[0]).unwrap(),
            "a second file"
        );
        assert!(take_from_inbox(&root.join("no inbox yet"), &to).is_empty());

        std::fs::remove_dir_all(&root).unwrap();
    }

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
