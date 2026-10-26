use crate::plugin_registry::{self, InstallResult, Registry};
use std::{path::PathBuf, time::Duration};
use tauri::AppHandle;
use tauri_plugin_fs::FsExt;

/// External packages live apart from the trusted local Mods/Plugins folder.
fn managed_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::config_root::path(app)?.join("ManagedPlugins"))
}

/// Blocking filesystem work must not run on the async executor.
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|error| error.to_string())?
}

/// The source must be an absolute path inside the filesystem scope. That scope is broader than
/// "just picked in the dialog" (it includes the user's home), so the real protection is that the
/// destination is fixed and the package is fully validated; the renderer chooses nothing else.
#[tauri::command]
pub async fn install_plugin_package(app: AppHandle, zip_path: String) -> Result<InstallResult, String> {
    let source = PathBuf::from(&zip_path);
    if !source.is_absolute() || !app.fs_scope().is_allowed(&source) {
        return Err("The plugin package must be selected with the file dialog".into());
    }
    let root = managed_root(&app)?;
    blocking(move || {
        plugin_registry::install(&root, &source, Duration::from_secs(crate::plugin_package::MAX_EXTRACT_SECONDS))
    })
    .await
}

#[tauri::command]
pub async fn list_external_plugins(app: AppHandle) -> Result<Registry, String> {
    let root = managed_root(&app)?;
    blocking(move || plugin_registry::list(&root)).await
}

#[tauri::command]
pub async fn remove_external_plugin(app: AppHandle, id: String) -> Result<(), String> {
    let root = managed_root(&app)?;
    blocking(move || plugin_registry::remove(&root, &id)).await
}
