mod commands;
mod config;
mod config_root;
mod plugin_install;
mod plugin_local;
mod plugin_package;
mod plugin_registry;
mod portable;
mod safe_copy;
mod ipc;
mod pdf;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut context = tauri::generate_context!();
    let portable = config_root::portable_exe_dir().is_some();
    if portable {
        // Tauri would create these windows before `setup` with the webview data folder under
        // %LOCALAPPDATA%. A portable run creates them itself, once the Data folder exists.
        for window in &mut context.config_mut().app.windows {
            window.create = false;
        }
    }
    tauri::Builder::default()
        .setup(move |app| {
            let started = config_root::initialize(app.handle()).and_then(|()| {
                if portable {
                    create_portable_windows(app)
                } else {
                    Ok(())
                }
            });
            if let Err(error) = started {
                let mode = if portable { portable::Mode::Portable } else { portable::Mode::Normal };
                return match portable::startup_failure_dialog(mode, &error) {
                    // A portable run has no console and no window yet: say what is wrong, then quit.
                    Some((title, text)) => {
                        show_startup_failure(app.handle().clone(), title, text);
                        Ok(())
                    }
                    None => Err(std::io::Error::other(error).into()),
                };
            }
            if let Err(error) = commands::preferences::rebase_portable(app.handle()) {
                eprintln!("could not move portable library paths: {error}");
                commands::error_logs::best_effort("native.startup", &error);
            }
            commands::plugins::protect_managed_root(app.handle()).map_err(std::io::Error::other)?;
            commands::error_logs::initialize(app.handle());
            config::ensure(app.handle());
            if let Err(error) = commands::preferences::restore_scopes(app.handle()) {
                eprintln!("could not restore library directories: {error}");
                commands::error_logs::best_effort("native.startup", &error);
            }
            Ok(())
        })
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            config_root::config_root,
            commands::files::list_markdown_files,
            commands::export::export_pdf,
            commands::export::pdf_export_route,
            commands::archive::pack_project,
            commands::archive::restore_project_archive,
            commands::version_control::git_status,
            commands::version_control::git_diff,
            commands::version_control::git_stage,
            commands::version_control::git_unstage,
            commands::version_control::git_revert,
            commands::version_control::git_commit_diff,
            commands::version_control::git_rollback,
            commands::version_control::git_commit,
            commands::version_control::git_auto_commit,
            commands::version_control::git_init,
            commands::workspace::restore_workspace,
            commands::workspace::rename_workspace,
            commands::rename_references::snapshot_rename_references,
            commands::rename_references::commit_rename_references,
            commands::replace_text::snapshot_project_texts,
            commands::replace_text::commit_project_replace,
            commands::workspace::open_folder,
            commands::workspace::delete_from_trash,
            commands::mods::open_mods_folder,
            commands::mods::delete_mod,
            commands::plugins::install_plugin_package,
            commands::plugins::list_external_plugins,
            commands::plugins::remove_external_plugin,
            commands::plugins::grant_plugin_consent,
            commands::plugins::revoke_plugin_consent,
            commands::plugins::set_external_plugin_active,
            commands::plugins::stop_external_plugin,
            commands::plugins::set_external_plugins_disabled,
            commands::plugins::read_external_plugin_entry,
            commands::plugins::log_external_plugin_event,
            commands::plugins::sync_local_plugin_packages,
            commands::preferences::load_library_paths,
            commands::preferences::change_library_path,
            commands::preferences::delete_user_theme,
            commands::preferences::load_settings,
            commands::preferences::save_settings,
            commands::error_logs::append_error_log,
        ])
        .run(context)
        .expect("error while running Grimoire Maker");
}

/// Shows a native error box without blocking the event loop, then exits the app with a failure code.
/// `blocking_show` must not run on the main thread, so the exit happens in the dialog callback.
fn show_startup_failure(handle: tauri::AppHandle, title: &'static str, text: String) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
    eprintln!("{title}: {text}");
    let exit = handle.clone();
    handle
        .dialog()
        .message(text)
        .title(title)
        .kind(MessageDialogKind::Error)
        .show(move |_| exit.exit(1));
}

/// Builds the configured windows with the WebView2 user data folder inside the portable `Data` folder.
fn create_portable_windows(app: &tauri::App) -> Result<(), String> {
    let handle = app.handle();
    let config = config_root::path(handle)?;
    let data = portable::webview_data_dir(config_root::mode(handle), &config)
        .ok_or("Portable mode is not active")?;
    let windows = app.config().app.windows.clone();
    for window in &windows {
        tauri::WebviewWindowBuilder::from_config(handle, window)
            .map_err(|error| error.to_string())?
            .data_directory(data.clone())
            .build()
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}
