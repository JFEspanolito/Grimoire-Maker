use std::fs;
use std::path::Path;

use tauri::{AppHandle, Manager};
use tauri_plugin_fs::FsExt;

const STATE_FILE: &str = "state.json";

fn normalize(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_string()
}

/// Whether `path` is one of the workspaces recorded in `state.json`.
fn is_remembered(app: &AppHandle, path: &str) -> Result<bool, String> {
    let state_path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(STATE_FILE);
    let Ok(raw) = fs::read_to_string(state_path) else {
        return Ok(false);
    };
    let state: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let wanted = normalize(path);
    Ok(state
        .get("recentWorkspaces")
        .and_then(|v| v.as_array())
        .is_some_and(|list| {
            list.iter()
                .filter_map(|v| v.as_str())
                .any(|p| normalize(p) == wanted)
        }))
}

/// Re-grants filesystem access to a workspace folder opened in a previous session.
///
/// The dialog plugin only grants scope for the running session, so a remembered
/// folder outside `$HOME` would be unreadable after a restart. Access is limited to
/// folders already recorded as recent workspaces, so this command cannot be used to
/// widen the scope to an arbitrary path.
#[tauri::command]
pub fn restore_workspace(app: AppHandle, path: String) -> Result<(), String> {
    if !Path::new(&path).is_dir() {
        return Err(format!("\"{path}\" is not an existing folder"));
    }
    if !is_remembered(&app, &path)? {
        return Err(format!("\"{path}\" is not a remembered workspace"));
    }
    app.fs_scope()
        .allow_directory(&path, true)
        .map_err(|e| e.to_string())
}
