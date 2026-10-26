mod commands;
mod config;
mod config_root;
mod plugin_bundled;
mod plugin_install;
mod plugin_package;
mod plugin_registry;
mod safe_copy;
mod ipc;
mod pdf;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            config_root::initialize(app.handle()).map_err(std::io::Error::other)?;
            commands::plugins::protect_managed_root(app.handle()).map_err(std::io::Error::other)?;
            commands::error_logs::initialize(app.handle());
            commands::plugins::ensure_bundled(app.handle());
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
            commands::version_control::git_commit,
            commands::version_control::git_auto_commit,
            commands::version_control::git_init,
            commands::workspace::restore_workspace,
            commands::workspace::rename_workspace,
            commands::rename_references::snapshot_rename_references,
            commands::rename_references::commit_rename_references,
            commands::workspace::open_folder,
            commands::workspace::delete_from_trash,
            commands::mods::open_mods_folder,
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
            commands::preferences::load_library_paths,
            commands::preferences::change_library_path,
            commands::preferences::delete_user_theme,
            commands::preferences::load_settings,
            commands::preferences::save_settings,
            commands::error_logs::append_error_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Grimoire Maker");
}
