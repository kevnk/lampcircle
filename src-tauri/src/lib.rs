mod analytics;
mod diagnostics;
mod downloads;
mod error;
mod feedback;
mod login_item;
mod session;
mod storage;
mod updater;

use std::path::PathBuf;

use error::Result;
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::menu::{
    AboutMetadata, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

pub(crate) fn settings_path(app: &AppHandle) -> Result<PathBuf> {
    Ok(app.path().app_config_dir()?.join("settings.json"))
}

#[tauri::command]
fn get_settings(app: AppHandle) -> Result<Option<Value>> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(serde_json::from_str(&std::fs::read_to_string(path)?)?))
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Value) -> Result<()> {
    let path = settings_path(&app)?;
    storage::write_json_atomic(&path, &settings)?;
    app.emit("settings-changed", &settings)?;
    Ok(())
}

#[tauri::command]
async fn send_feedback(app: AppHandle, message: String, email: Option<String>) -> Result<()> {
    let url = feedback::relay_url(feedback::RELAY_URL)?;
    let payload = feedback::payload(
        &message,
        email.as_deref(),
        &app.package_info().version.to_string(),
    )?;
    feedback::send(url, &payload).await?;
    analytics::track_feedback_sent(&app, email.is_some());
    Ok(())
}

#[tauri::command]
async fn check_for_update(
    app: AppHandle,
    pending: State<'_, updater::Pending>,
) -> Result<updater::UpdateCheck> {
    updater::check(&app, &pending).await
}

#[tauri::command]
async fn install_update(
    app: AppHandle,
    pending: State<'_, updater::Pending>,
    channel: Channel<updater::UpdateProgress>,
) -> Result<()> {
    updater::install(&app, &pending, channel).await
}

#[tauri::command]
fn relaunch(app: AppHandle) {
    app.restart()
}

fn focus_main_window(app: &AppHandle) {
    let mut restored = true;
    #[cfg(target_os = "macos")]
    if let Err(error) = app.show() {
        log::warn!("Could not unhide the application after a duplicate launch: {error}");
        log::warn!(
            target: diagnostics::SUPPORT_LOG_TARGET,
            "duplicate_launch_app_unhide_failed"
        );
        restored = false;
    }

    let Some(window) = app.get_webview_window("main") else {
        log::warn!("Could not find the main window after a duplicate launch");
        log::warn!(
            target: diagnostics::SUPPORT_LOG_TARGET,
            "duplicate_launch_main_window_missing"
        );
        return;
    };
    if let Err(error) = window.show() {
        log::warn!("Could not show the main window after a duplicate launch: {error}");
        log::warn!(
            target: diagnostics::SUPPORT_LOG_TARGET,
            "duplicate_launch_window_show_failed"
        );
        restored = false;
    }
    if let Err(error) = window.unminimize() {
        log::warn!("Could not restore the main window after a duplicate launch: {error}");
        log::warn!(
            target: diagnostics::SUPPORT_LOG_TARGET,
            "duplicate_launch_window_unminimize_failed"
        );
        restored = false;
    }
    if let Err(error) = window.set_focus() {
        log::warn!("Could not focus the main window after a duplicate launch: {error}");
        log::warn!(
            target: diagnostics::SUPPORT_LOG_TARGET,
            "duplicate_launch_window_focus_failed"
        );
        restored = false;
    }
    if restored {
        log::info!(
            target: diagnostics::SUPPORT_LOG_TARGET,
            "duplicate_launch_window_restored"
        );
    }
}

fn show_settings(app: &AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window("settings") {
        window.show()?;
        window.set_focus()?;
        return Ok(());
    }
    let builder = WebviewWindowBuilder::new(
        app,
        "settings",
        WebviewUrl::App("index.html?window=settings".into()),
    )
    .title("Settings")
    .inner_size(540.0, 720.0)
    .resizable(false)
    .minimizable(false);
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::Position::Logical(tauri::LogicalPosition::new(
            16.0, 27.0,
        )));
    builder.build()?;
    Ok(())
}

#[tauri::command]
fn open_settings(app: AppHandle) -> Result<()> {
    show_settings(&app)
}

fn build_menu(app: &AppHandle) -> tauri::Result<()> {
    let about = PredefinedMenuItem::about(
        app,
        Some("About Lampcircle"),
        Some(AboutMetadata::default()),
    )?;
    let check_update = MenuItemBuilder::with_id("check-update", "Check for Updates…").build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let shortcuts = MenuItemBuilder::with_id("shortcuts", "Keyboard Shortcuts…")
        .accelerator("CmdOrCtrl+/")
        .build(app)?;
    let feedback = MenuItemBuilder::with_id("feedback", "Send Feedback…")
        .accelerator("CmdOrCtrl+Shift+F")
        .build(app)?;

    let app_menu = SubmenuBuilder::new(app, "Lampcircle")
        .item(&about)
        .item(&check_update)
        .separator()
        .item(&settings)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    // A custom menu replaces the default one, so without this Cmd+V would not paste a YouTube link.
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&shortcuts)
        .item(&feedback)
        .build()?;
    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .separator()
        .close_window()
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &edit_menu, &window_menu, &help_menu])
        .build()?;
    app.set_menu(menu)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Tauri requires the single-instance plugin to be the first registered plugin.
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(
        |app, _arguments, _working_directory| focus_main_window(app),
    ));

    let builder = builder
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .max_file_size(diagnostics::MAX_LOG_FILE_SIZE)
                .rotation_strategy(RotationStrategy::KeepSome(diagnostics::LOG_FILES_TO_KEEP))
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir {
                        file_name: Some(diagnostics::LOG_FILE_NAME.into()),
                    })
                    .filter(|metadata| metadata.target() == diagnostics::SUPPORT_LOG_TARGET),
                ])
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init());

    #[cfg(feature = "aptabase")]
    let builder = match analytics::APP_KEY.filter(|key| !key.trim().is_empty()) {
        Some(key) => builder.plugin(freshjuice_tauri_aptabase::Builder::new(key).build()),
        None => builder,
    };

    builder
        .manage(updater::Pending::default())
        .setup(|app| {
            let library = app.path().app_data_dir()?.join("library");
            app.manage::<downloads::Shared>(std::sync::Arc::new(downloads::Downloads::new(library)?));
            build_menu(app.handle())?;
            log::info!(target: diagnostics::SUPPORT_LOG_TARGET, "application_ready");
            app.on_menu_event(|app, event| match event.id().0.as_str() {
                "settings" => {
                    let _ = show_settings(app);
                }
                command => {
                    // ⌘W only hides the main window, so bring it back before it shows a dialog.
                    focus_main_window(app);
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("command", command);
                    }
                }
            });
            Ok(())
        })
        // Closing the main window hides it, so a stray Cmd+W mid-set keeps the music going. The Dock icon brings it back.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            send_feedback,
            check_for_update,
            install_update,
            relaunch,
            open_settings,
            login_item::set_open_at_login,
            login_item::get_open_at_login,
            session::get_last_session,
            session::save_last_session,
            session::clear_last_session,
            diagnostics::export_diagnostics,
            downloads::download_jobs,
            downloads::add_download,
            downloads::list_playlist,
            downloads::remove_download,
            downloads::library_file,
            downloads::save_text,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            tauri::RunEvent::Ready => analytics::track_app_opened(app),
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => focus_main_window(app),
            _ => {}
        });
}
