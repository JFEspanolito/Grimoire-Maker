mod commands;
mod config;
mod ipc;
mod pdf;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            config::ensure(app.handle());
            Ok(())
        })
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::files::list_markdown_files,
            commands::export::export_pdf,
            commands::export::pdf_export_route,
            commands::archive::pack_project,
            commands::archive::restore_project_archive,
            commands::workspace::restore_workspace,
            commands::workspace::rename_workspace,
            commands::workspace::open_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Grimoire Maker");
}
