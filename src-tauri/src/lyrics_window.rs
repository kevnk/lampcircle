//! The lyrics window: borderless and fullscreen on a chosen screen, for a projector or a TV on AirPlay.
//! Perform sends it cues as events, so nothing here knows about songs.

use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::utils::config::BackgroundThrottlingPolicy;
use tauri::window::Color;
use tauri::{
    AppHandle, Emitter, Manager, Monitor, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent,
};

use crate::error::{AppError, Result};

const LABEL: &str = "lyrics";
const MAIN: &str = "main";
/// Time for macOS to finish leaving the old window's fullscreen Space before a new one starts.
const SPACE_SETTLE: Duration = Duration::from_millis(500);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    id: String,
    name: Option<String>,
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    is_primary: bool,
}

/// How the page tells screens apart. On macOS the name is only a model number, which two of the same TV share.
fn monitor_id(monitor: &Monitor) -> String {
    let position = monitor.position();
    format!(
        "{}@{},{}",
        monitor.name().map_or("", String::as_str),
        position.x,
        position.y
    )
}

#[tauri::command]
pub fn list_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>> {
    let primary = app.primary_monitor()?.map(|monitor| monitor_id(&monitor));
    Ok(app
        .available_monitors()?
        .iter()
        .map(|monitor| {
            let id = monitor_id(monitor);
            MonitorInfo {
                is_primary: primary.as_ref() == Some(&id),
                name: monitor.name().cloned(),
                width: monitor.size().width,
                height: monitor.size().height,
                x: monitor.position().x,
                y: monitor.position().y,
                id,
            }
        })
        .collect())
}

/// The screen the window is on now. None when it isn't open.
#[tauri::command]
pub fn lyrics_display_monitor(app: AppHandle) -> Result<Option<String>> {
    let Some(window) = app.get_webview_window(LABEL) else {
        return Ok(None);
    };
    Ok(window
        .current_monitor()?
        .map(|monitor| monitor_id(&monitor)))
}

/// Opens the window on a screen, or moves it there, and returns that screen's id. With no screen named, it takes a
/// second one if there is one. Async so that waiting for an old window to go never holds up the main thread.
#[tauri::command]
pub async fn open_lyrics_display(app: AppHandle, monitor: Option<String>) -> Result<String> {
    let monitors = app.available_monitors()?;
    let primary = app.primary_monitor()?.map(|screen| monitor_id(&screen));
    let target = match &monitor {
        Some(id) => monitors.iter().find(|screen| monitor_id(screen) == *id),
        None => monitors
            .iter()
            .find(|screen| Some(monitor_id(screen)) != primary)
            .or(monitors.first()),
    }
    .ok_or_else(|| AppError::Message("That display is no longer connected.".into()))?;
    let id = monitor_id(target);

    if let Some(window) = app.get_webview_window(LABEL) {
        if window
            .current_monitor()?
            .is_some_and(|screen| monitor_id(&screen) == id)
        {
            window.show()?;
            return Ok(id);
        }
        // A fullscreen window can't be moved: leaving fullscreen animates, and the end of that animation puts it back.
        window.destroy()?;
        wait_until_closed(&app)?;
    }

    // Not `set_fullscreen_on_monitor`: it looks a screen up by physical position in list order, so a Retina Mac's main
    // screen also claims the origin of a 1x projector beside it. tao takes a fullscreen window's screen from this
    // logical position, checked against each screen at its own scale.
    let scale = target.scale_factor();
    let position = target.position();
    WebviewWindowBuilder::new(
        &app,
        LABEL,
        WebviewUrl::App("index.html?window=lyrics".into()),
    )
    .title("Lamp Circle lyrics")
    .decorations(false)
    .position(position.x as f64 / scale, position.y as f64 / scale)
    .fullscreen(true)
    .focused(false)
    .background_color(Color(0, 0, 0, 255))
    .background_throttling(BackgroundThrottlingPolicy::Disabled)
    .build()?;
    Ok(id)
}

fn wait_until_closed(app: &AppHandle) -> Result<()> {
    let deadline = Instant::now() + Duration::from_secs(3);
    while app.get_webview_window(LABEL).is_some() {
        if Instant::now() > deadline {
            return Err(AppError::Message(
                "The lyrics window would not close.".into(),
            ));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    std::thread::sleep(SPACE_SETTLE);
    Ok(())
}

#[tauri::command]
pub fn close_lyrics_display(app: AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window.destroy()?;
    }
    Ok(())
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != LABEL {
        return;
    }
    let app = window.app_handle();
    match event {
        WindowEvent::Destroyed => {
            let _ = app.emit_to(MAIN, "lyrics-display-closed", ());
        }
        WindowEvent::Focused(true) => hand_keys_to_perform(window),
        _ => {}
    }
}

/// Going fullscreen or a stray click can give this window the keyboard, and Perform's Space and Esc must keep working.
/// When it fills the screen Perform is on, the keys stay here, so ⌘W can close it and bring Perform back.
fn hand_keys_to_perform(window: &Window) {
    let Some(main) = window.app_handle().get_webview_window(MAIN) else {
        return;
    };
    let same_screen = match (window.current_monitor(), main.current_monitor()) {
        (Ok(Some(here)), Ok(Some(there))) => monitor_id(&here) == monitor_id(&there),
        _ => false,
    };
    if !same_screen {
        let _ = main.set_focus();
    }
}
