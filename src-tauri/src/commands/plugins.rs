use crate::{plugin_bundled, plugin_registry::{self, InstallResult, Registry}};
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

#[tauri::command]
pub async fn grant_plugin_consent(
    app: AppHandle,
    id: String,
    version: String,
    fingerprint: String,
    granted: Vec<String>,
    sdk_version: u32,
) -> Result<(), String> {
    let root = managed_root(&app)?;
    blocking(move || plugin_registry::grant_consent(&root, &id, &version, &fingerprint, &granted, sdk_version)).await
}

#[tauri::command]
pub async fn revoke_plugin_consent(app: AppHandle, id: String) -> Result<(), String> {
    let root = managed_root(&app)?;
    blocking(move || plugin_registry::revoke_consent(&root, &id)).await
}

#[tauri::command]
pub async fn set_external_plugin_active(app: AppHandle, id: String, active: bool) -> Result<(), String> {
    let root = managed_root(&app)?;
    blocking(move || plugin_registry::set_active(&root, &id, active)).await
}

/// Called when the host terminated a running plugin; the reason goes to the audit trail.
#[tauri::command]
pub async fn stop_external_plugin(app: AppHandle, id: String, reason: String) -> Result<(), String> {
    let root = managed_root(&app)?;
    blocking(move || plugin_registry::mark_stopped(&root, &id, &reason)).await
}

#[tauri::command]
pub async fn set_external_plugins_disabled(app: AppHandle, disabled: bool) -> Result<(), String> {
    let root = managed_root(&app)?;
    blocking(move || plugin_registry::set_disabled_all(&root, disabled)).await
}

/// Integrity is verified again here, at every start, before any byte is handed to the runtime.
#[tauri::command]
pub async fn read_external_plugin_entry(app: AppHandle, id: String) -> Result<plugin_registry::EntryPayload, String> {
    let root = managed_root(&app)?;
    blocking(move || plugin_registry::read_entry(&root, &id)).await
}

#[tauri::command]
pub async fn log_external_plugin_event(app: AppHandle, id: String, event: String, detail: String) -> Result<(), String> {
    let root = managed_root(&app)?;
    blocking(move || plugin_registry::log_event(&root, &id, &event, &detail)).await
}

/// Keeps the renderer's filesystem access away from installed plugin files and the registry: they
/// change only through the commands above, which validate every step.
pub fn protect_managed_root(app: &AppHandle) -> Result<(), String> {
    let root = managed_root(app)?;
    plugin_registry::recover(&root)?;
    app.fs_scope().forbid_directory(&root, true).map_err(|error| error.to_string())
}

/// Installs or repairs the first-party packages embedded in the binary. A failure is logged and
/// never aborts startup: the plugins simply stay as they were.
pub fn ensure_bundled(app: &AppHandle) {
    if let Err(error) = managed_root(app).and_then(|root| plugin_bundled::ensure(&root)) {
        eprintln!("could not install the bundled plugins: {error}");
        super::error_logs::best_effort("native.plugins.bundled", &error);
    }
}
