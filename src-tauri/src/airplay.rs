//! The words on a TV, from an iPhone or iPad. Pick an Apple TV in Screen Mirroring and iOS gives the app a scene for
//! that screen. A Tauri window on it replaces the mirrored picture with the lyrics page, which takes the same cues the
//! Mac's lyrics window does, on the same clock. With no window there, the TV goes on mirroring the phone.
//!
//! The commands share their names with src/lyrics_window.rs, so the page asks the same way on both.
//!
//! Never `window.destroy()` here. On iOS it releases the window without telling Tauri, which then holds the label for
//! good. Ending the scene does tell it: `sceneDidDisconnect` sends `Destroyed` for the windows on that scene.

use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject};
use objc2::{msg_send, MainThreadMarker};
use objc2_ui_kit::{
    UIApplication, UIScene, UISceneConfiguration, UIView, UIWindowScene,
    UIWindowSceneSessionRoleExternalDisplayNonInteractive,
};
use serde::Serialize;
use tauri::utils::config::BackgroundThrottlingPolicy;
use tauri::window::Color;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::error::{AppError, Result};

const LABEL: &str = "lyrics";
/// `AIRPLAY_TV` in src/lib/lyricsWindow.ts.
const TV: &str = "airplay-tv";

/// False from Turn off until Display. A new launch starts on, so picking the TV is all it takes.
static WANTED: AtomicBool = AtomicBool::new(true);

thread_local! {
    /// The request for the TV's scene, from iOS 27. Main thread only, like everything of UIKit's.
    static REGISTRATION: RefCell<Option<Retained<AnyObject>>> = const { RefCell::new(None) };
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    id: &'static str,
    name: Option<&'static str>,
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    is_primary: bool,
}

/// From iOS 27, an app built with its SDK gets the TV's scene only while a view controller on screen asks for one.
/// Earlier versions offer it unasked. tao's delegate takes it either way, and it comes out as `SceneRequested`.
pub fn setup(app: &tauri::App) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let asked = main.with_webview(|webview| {
        let (Some(mtm), Some(accessory), Some(delegate)) = (
            MainThreadMarker::new(),
            AnyClass::get(c"UISceneAccessory"),
            AnyClass::get(c"TaoSceneDelegate"),
        ) else {
            return;
        };
        // SAFETY: both selectors exist wherever UISceneAccessory does, and `view_controller` is this window's live
        // UIViewController. with_webview runs this on the main thread.
        unsafe {
            // Any name will do, so it goes by its role. No plist entry: the delegate class is set right here.
            let role = UIWindowSceneSessionRoleExternalDisplayNonInteractive;
            let config = UISceneConfiguration::configurationWithName_sessionRole(Some(role), role, mtm);
            config.setDelegateClass(Some(delegate));
            // The phone must work with no TV, so a surprise here only means no TV.
            let accessory: Option<Retained<AnyObject>> =
                msg_send![accessory, externalNonInteractiveSceneAccessoryWithConfiguration: &*config];
            let Some(accessory) = accessory else {
                return;
            };
            let controller = webview.view_controller().cast::<AnyObject>();
            let registration: Option<Retained<AnyObject>> =
                msg_send![controller, registerSceneAccessory: &*accessory];
            REGISTRATION.set(registration);
        }
    });
    if let Err(error) = asked {
        log::warn!("Could not ask for the TV's scene: {error}");
    }
}

/// A scene iOS offered the app. tao makes no window for it, so one for a TV gets ours.
pub fn scene_requested(app: &AppHandle, scene: &UIScene) {
    if let (true, Some(mtm)) = (is_tv(scene), MainThreadMarker::new()) {
        show(app, mtm);
    }
}

fn is_tv(scene: &UIScene) -> bool {
    // SAFETY: Apple's constant, there since iOS 16, the oldest this app runs on.
    scene
        .session()
        .role()
        .isEqualToString(unsafe { UIWindowSceneSessionRoleExternalDisplayNonInteractive })
}

fn tv_scene(mtm: MainThreadMarker) -> Option<Retained<UIWindowScene>> {
    UIApplication::sharedApplication(mtm)
        .connectedScenes()
        .iter()
        .find(|scene| is_tv(scene))
        .and_then(|scene| scene.downcast::<UIWindowScene>().ok())
}

/// A TV to use. While it's turned off from iOS 27 there's no scene, so the registration has to say so.
fn connected(mtm: MainThreadMarker) -> bool {
    tv_scene(mtm).is_some()
        || REGISTRATION.with_borrow(|registration| {
            registration.as_ref().is_some_and(|registration| {
                // SAFETY: a BOOL property of UISceneAccessoryRegistration, read on the main thread.
                unsafe { msg_send![&**registration, isAvailable] }
            })
        })
}

/// Turns the request on or off. False before iOS 27, which has no request.
fn set_enabled(enabled: bool) -> bool {
    REGISTRATION.with_borrow(|registration| {
        let Some(registration) = registration else {
            return false;
        };
        // SAFETY: a BOOL property of UISceneAccessoryRegistration, set on the main thread.
        let () = unsafe { msg_send![&**registration, setEnabled: enabled] };
        true
    })
}

/// Puts the lyrics window on the TV. Safe to repeat: it also catches a scene that was missed, a screen that changed
/// size, and a window left from an earlier scene. Needs a scene: with none, tao puts a new window on the phone's, over
/// Perform.
fn show(app: &AppHandle, mtm: MainThreadMarker) {
    if !WANTED.load(Ordering::Relaxed) || tv_scene(mtm).is_none() {
        return;
    }
    let window = match app.get_webview_window(LABEL) {
        Some(window) => window,
        None => {
            // tao gives a new window the one connected scene with no windows, which is this one. It takes the size
            // from the phone's screen, so `fitted` sets that right.
            let built = WebviewWindowBuilder::new(
                app,
                LABEL,
                WebviewUrl::App("index.html?window=lyrics".into()),
            )
            .background_color(Color(0, 0, 0, 255))
            .background_throttling(BackgroundThrottlingPolicy::Disabled)
            .build();
            match built {
                Ok(window) => window,
                Err(error) => {
                    log::warn!("Could not put the words on the TV: {error}");
                    return;
                }
            }
        }
    };
    if let Err(error) = window.with_webview(fitted) {
        log::warn!("Could not fit the words to the TV: {error}");
    }
}

/// Fills the TV's screen, with the black behind the page showing until it first paints.
fn fitted(webview: tauri::webview::PlatformWebview) {
    let Some(scene) = MainThreadMarker::new().and_then(tv_scene) else {
        return;
    };
    // SAFETY: on iOS `inner` is the WKWebView, a UIView, and with_webview runs this on the main thread.
    let view = unsafe { &*webview.inner().cast::<UIView>() };
    view.setOpaque(false);
    if let Some(window) = view.window() {
        window.setWindowScene(Some(&scene));
        window.setFrame(scene.screen().bounds());
    }
}

/// Runs a job on the main thread and waits for its answer. From the main thread, it runs right here.
fn on_main<T: Send + 'static>(
    app: &AppHandle,
    job: impl FnOnce(MainThreadMarker, &AppHandle) -> T + Send + 'static,
) -> Result<T> {
    let (answer, answered) = mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        if let Some(mtm) = MainThreadMarker::new() {
            let _ = answer.send(job(mtm, &handle));
        }
    })?;
    answered
        .recv()
        .map_err(|_| AppError::Message("The display did not answer.".into()))
}

/// The TV, if there is one. Its size waits for the scene, so it's 0 while turned off.
#[tauri::command]
pub fn list_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>> {
    on_main(&app, |mtm, _| {
        if !connected(mtm) {
            return Vec::new();
        }
        let size = tv_scene(mtm).map(|scene| scene.screen().nativeBounds().size);
        vec![MonitorInfo {
            id: TV,
            name: Some("TV"),
            width: size.map_or(0, |size| size.width as u32),
            height: size.map_or(0, |size| size.height as u32),
            x: 0,
            y: 0,
            is_primary: false,
        }]
    })
}

/// `TV` only with the window really on the TV's scene, so the button never claims more than that. The page asks every
/// couple of seconds on Perform.
#[tauri::command]
pub fn lyrics_display_monitor(app: AppHandle) -> Result<Option<String>> {
    on_main(&app, |mtm, app| {
        show(app, mtm);
        let on = WANTED.load(Ordering::Relaxed)
            && tv_scene(mtm).is_some()
            && app.get_webview_window(LABEL).is_some();
        on.then(|| TV.to_owned())
    })
}

#[tauri::command]
pub fn open_lyrics_display(app: AppHandle, monitor: Option<String>) -> Result<String> {
    let _ = monitor;
    let on = on_main(&app, |mtm, app| {
        WANTED.store(true, Ordering::Relaxed);
        set_enabled(true);
        show(app, mtm);
        connected(mtm)
    })?;
    if on {
        Ok(TV.to_owned())
    } else {
        Err(AppError::Message("No TV is connected.".into()))
    }
}

/// Ends the TV's scene, which takes the window with it, and the TV goes back to mirroring the phone.
#[tauri::command]
pub fn close_lyrics_display(app: AppHandle) -> Result<()> {
    on_main(&app, |mtm, _| {
        WANTED.store(false, Ordering::Relaxed);
        if set_enabled(false) {
            return;
        }
        if let Some(scene) = tv_scene(mtm) {
            UIApplication::sharedApplication(mtm)
                .requestSceneSessionDestruction_options_errorHandler(&scene.session(), None, None);
        }
    })
}
