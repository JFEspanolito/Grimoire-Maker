use std::fs;
use std::path::Path;
use std::process::Command;

use serde_json::Value;
use tauri::{AppHandle, Manager};
use tauri_plugin_fs::FsExt;

fn normalize(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_string()
}

/// Whether `path` is one of the workspaces recorded in `state.json`.
fn is_remembered(app: &AppHandle, path: &str) -> Result<bool, String> {
    let state_path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(crate::config::STATE_FILE);
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

fn valid_project_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit()
            && stem.as_bytes()[3] != b'0');
    !name.is_empty()
        && name.trim() == name
        && name != "."
        && name != ".."
        && !name.ends_with('.')
        && !reserved
        && !name
            .chars()
            .any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
}

fn remap_path(value: &str, from: &str, to: &str) -> String {
    let path = normalize(value);
    if path == from {
        return to.to_string();
    }
    if let Some(suffix) = path.strip_prefix(&format!("{from}/")) {
        return format!("{to}/{suffix}");
    }
    value.to_string()
}

fn rename_workspace_in(
    state_path: &Path,
    path: &Path,
    name: &str,
    grant_scope: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<String, String> {
    if !valid_project_name(name) {
        return Err("Invalid project name".into());
    }
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("Project folder is not a regular directory".into());
    }
    let parent = path.parent().ok_or("Cannot rename a filesystem root")?;
    let old_name = path.file_name().ok_or("Cannot rename a filesystem root")?;
    let old = normalize(&path.to_string_lossy());
    let raw = fs::read_to_string(state_path).map_err(|e| e.to_string())?;
    let mut state: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if state
        .get("lastWorkspace")
        .and_then(Value::as_str)
        .map(normalize)
        .as_deref()
        != Some(&old)
        || !state
            .get("recentWorkspaces")
            .and_then(Value::as_array)
            .is_some_and(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .any(|item| normalize(item) == old)
            })
    {
        return Err("Project folder is not the active remembered workspace".into());
    }
    if old_name == name {
        return Ok(old);
    }
    let destination = parent.join(name);
    if fs::symlink_metadata(&destination).is_ok() {
        return Err("A folder with that project name already exists".into());
    }
    let next = normalize(&destination.to_string_lossy());
    state["lastWorkspace"] = Value::String(next.clone());
    if let Some(recent) = state
        .get_mut("recentWorkspaces")
        .and_then(Value::as_array_mut)
    {
        for item in recent {
            if let Some(value) = item.as_str() {
                *item = Value::String(remap_path(value, &old, &next));
            }
        }
    }
    if let Some(last_file) = state.get("lastFile").and_then(Value::as_str) {
        state["lastFile"] = Value::String(remap_path(last_file, &old, &next));
    }
    let updated = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;

    fs::rename(path, &destination).map_err(|e| e.to_string())?;
    if let Err(e) = grant_scope(&destination) {
        let rollback = fs::rename(&destination, path);
        return Err(format!(
            "Could not access renamed project: {e}; rollback: {rollback:?}"
        ));
    }
    if let Err(e) = fs::write(state_path, updated) {
        let rollback = fs::rename(&destination, path);
        let restore_state = fs::write(state_path, raw);
        return Err(format!("Could not save renamed project: {e}; folder rollback: {rollback:?}; state rollback: {restore_state:?}"));
    }
    Ok(next)
}

/// Renames only the active remembered project, including its persisted workspace and file paths.
#[tauri::command]
pub fn rename_workspace(app: AppHandle, path: String, name: String) -> Result<String, String> {
    let state_path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(crate::config::STATE_FILE);
    rename_workspace_in(&state_path, Path::new(&path), &name, |destination| {
        app.fs_scope()
            .allow_directory(destination, true)
            .map_err(|e| e.to_string())
    })
}

fn open_folder_in(
    state_path: &Path,
    folder: &Path,
    launch: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), String> {
    if !folder.is_dir() {
        return Err("The selected path is not a folder".into());
    }
    let raw = fs::read_to_string(state_path).map_err(|e| e.to_string())?;
    let state: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let root = state
        .get("lastWorkspace")
        .and_then(Value::as_str)
        .ok_or("No active project folder")?;
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let selected = fs::canonicalize(folder).map_err(|e| e.to_string())?;
    if !selected.starts_with(root) {
        return Err("The folder is outside the active project".into());
    }
    // Use native separators for the OS launcher rather than the UI's portable paths.
    let launch_path: std::path::PathBuf = folder.components().collect();
    launch(&launch_path)
}

/// Opens an active-project directory in the operating system's file explorer.
#[tauri::command]
pub fn open_folder(app: AppHandle, path: String) -> Result<(), String> {
    let state_path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(crate::config::STATE_FILE);
    open_folder_in(&state_path, Path::new(&path), |folder| {
        #[cfg(target_os = "windows")]
        let program = "explorer.exe";
        #[cfg(target_os = "macos")]
        let program = "open";
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        let program = "xdg-open";
        Command::new(program)
            .arg(folder)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renames_project_without_losing_files_or_session_paths() {
        let base =
            std::env::temp_dir().join(format!("grimoire-rename-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let old = base.join("Old Project");
        fs::create_dir_all(old.join("Draft")).unwrap();
        fs::write(old.join("Draft/chapter.md"), "# Existing chapter").unwrap();
        let state_path = base.join("state.json");
        fs::write(&state_path, format!(
            r#"{{"lastWorkspace":"{}","recentWorkspaces":["{}"],"lastFile":"{}/Draft/chapter.md","settings":{{"theme":"parchment"}}}}"#,
            normalize(&old.to_string_lossy()), normalize(&old.to_string_lossy()), normalize(&old.to_string_lossy())
        )).unwrap();

        let next = rename_workspace_in(&state_path, &old, "New Project", |_| Ok(())).unwrap();

        assert_eq!(next, normalize(&base.join("New Project").to_string_lossy()));
        assert!(!old.exists());
        assert_eq!(
            fs::read_to_string(base.join("New Project/Draft/chapter.md")).unwrap(),
            "# Existing chapter"
        );
        let state: Value = serde_json::from_str(&fs::read_to_string(&state_path).unwrap()).unwrap();
        assert_eq!(state["lastWorkspace"], next);
        assert_eq!(state["lastFile"], format!("{next}/Draft/chapter.md"));
        assert_eq!(state["settings"]["theme"], "parchment");
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn rejects_name_collision_without_changing_files_or_state() {
        let base = std::env::temp_dir().join(format!(
            "grimoire-rename-collision-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&base);
        let old = base.join("Old");
        fs::create_dir_all(&old).unwrap();
        fs::create_dir_all(base.join("Taken")).unwrap();
        let state_path = base.join("state.json");
        let raw = format!(
            r#"{{"lastWorkspace":"{}","recentWorkspaces":["{}"]}}"#,
            normalize(&old.to_string_lossy()),
            normalize(&old.to_string_lossy())
        );
        fs::write(&state_path, &raw).unwrap();

        assert!(rename_workspace_in(&state_path, &old, "Taken", |_| Ok(())).is_err());
        assert!(old.is_dir());
        assert!(base.join("Taken").is_dir());
        assert_eq!(fs::read_to_string(&state_path).unwrap(), raw);
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn rolls_back_folder_when_new_scope_cannot_be_granted() {
        let base =
            std::env::temp_dir().join(format!("grimoire-rename-scope-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let old = base.join("Old");
        fs::create_dir_all(&old).unwrap();
        let state_path = base.join("state.json");
        let raw = format!(
            r#"{{"lastWorkspace":"{}","recentWorkspaces":["{}"]}}"#,
            normalize(&old.to_string_lossy()),
            normalize(&old.to_string_lossy())
        );
        fs::write(&state_path, &raw).unwrap();

        assert!(
            rename_workspace_in(&state_path, &old, "New", |_| Err("scope denied".into())).is_err()
        );
        assert!(old.is_dir());
        assert!(!base.join("New").exists());
        assert_eq!(fs::read_to_string(&state_path).unwrap(), raw);
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn rejects_unsafe_project_names() {
        for name in [
            "",
            "..",
            "bad/name",
            "bad\\name",
            "CON",
            "trailing.",
            " leading",
        ] {
            assert!(!valid_project_name(name), "{name:?} must be rejected");
        }
        assert!(valid_project_name("My Grimoire"));
    }

    #[test]
    fn opens_only_directories_inside_the_active_project() {
        let base =
            std::env::temp_dir().join(format!("grimoire-open-folder-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let project = base.join("Project");
        let chapter = project.join("Draft/chapter.md");
        fs::create_dir_all(chapter.parent().unwrap()).unwrap();
        fs::create_dir_all(base.join("Outside")).unwrap();
        fs::write(&chapter, "# Chapter").unwrap();
        let state_path = base.join("state.json");
        fs::write(
            &state_path,
            format!(
                r#"{{"lastWorkspace":"{}"}}"#,
                normalize(&project.to_string_lossy())
            ),
        )
        .unwrap();

        let mut launched = false;
        let normalized_folder = normalize(&project.join("Draft").to_string_lossy());
        open_folder_in(&state_path, Path::new(&normalized_folder), |folder| {
            launched = true;
            #[cfg(target_os = "windows")]
            assert!(!folder.as_os_str().to_string_lossy().contains('/'));
            Ok(())
        })
        .unwrap();
        assert!(launched);
        assert!(
            open_folder_in(&state_path, &base.join("Outside"), |_| panic!(
                "must not launch"
            ))
            .is_err()
        );
        assert!(open_folder_in(&state_path, &chapter, |_| panic!("must not launch")).is_err());
        fs::remove_dir_all(base).unwrap();
    }
}
