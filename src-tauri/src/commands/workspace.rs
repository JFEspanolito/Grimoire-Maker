use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;
use tauri::{AppHandle, Manager};
use tauri_plugin_fs::FsExt;

fn normalize(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_string()
}

/// Whether `path` is one of the workspaces recorded in `state.json`.
fn is_remembered(app: &AppHandle, path: &str) -> Result<bool, String> {
    let state_path = crate::config_root::path(app)?
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
#[tauri::command(async)]
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

/// The folder a standalone document may read: its own folder, resolved through links,
/// and only for a Markdown or text file already in scope. A document directly in the
/// home folder gets only its `assets/` folder; one at a drive root gets nothing more.
fn document_folder(path: &Path, allowed: bool, home: Option<&Path>) -> Result<PathBuf, String> {
    if !path.is_file() {
        return Err(format!("\"{}\" is not an existing file", path.display()));
    }
    if !allowed {
        return Err("Only a document you opened or saved can share its folder".into());
    }
    let document = path.extension().and_then(|ext| ext.to_str()).map(str::to_ascii_lowercase);
    if !matches!(document.as_deref(), Some("md" | "txt")) {
        return Err("Only Markdown and text documents can share their folder".into());
    }
    // Grant the canonical folder, the one checked below, so a link cannot point the grant elsewhere.
    let canonical = |path: &Path| -> Result<PathBuf, String> {
        Ok(PathBuf::from(super::rename_references::portable(&fs::canonicalize(path).map_err(|e| e.to_string())?)?))
    };
    let folder = canonical(path)?
        .parent()
        .map(Path::to_path_buf)
        .ok_or("The document has no folder")?;
    if folder.parent().is_none() {
        return Err("Documents at a drive root keep access to the file only".into());
    }
    if home.map(canonical).transpose()?.as_deref() == Some(folder.as_path()) {
        return Ok(folder.join("assets"));
    }
    Ok(folder)
}

/// Lets a document opened or saved outside a project read the images next to it
/// (and create its `assets/` folder). The dialog only grants the file itself.
#[tauri::command]
pub fn grant_document_folder(app: AppHandle, path: String) -> Result<(), String> {
    let file = Path::new(&path);
    let home = app.path().home_dir().ok();
    let folder = document_folder(file, app.fs_scope().is_allowed(file), home.as_deref())?;
    app.fs_scope()
        .allow_directory(&folder, true)
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
    let _guard = super::app_state::STATE_LOCK.lock().map_err(|_| "Session state lock unavailable")?;
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
#[tauri::command(async)]
pub fn rename_workspace(app: AppHandle, path: String, name: String) -> Result<String, String> {
    let state_path = crate::config_root::path(&app)?
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
    let resolved = super::rename_references::portable(&selected)?;
    let launch_path: std::path::PathBuf = Path::new(&resolved).components().collect();
    launch(&launch_path)
}

/// Opens an external HTTP, HTTPS or mailto URL in the default application.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") && !url.starts_with("mailto:") {
        return Err("Only http, https, and mailto URLs are allowed".into());
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url])
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&url)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

/// Opens an active-project directory in the operating system's file explorer.
#[tauri::command]
pub fn open_folder(app: AppHandle, path: String) -> Result<(), String> {
    let state_path = crate::config_root::path(&app)?
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

/// Sends something that is already in the active project's Trash to the system recycle bin.
/// Anything outside `<project>/Trash`, and the Trash folder itself, is refused.
fn recycle_from_trash_in(
    state_path: &Path,
    target: &Path,
    recycle: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), String> {
    let raw = fs::read_to_string(state_path).map_err(|e| e.to_string())?;
    let state: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let root = state
        .get("lastWorkspace")
        .and_then(Value::as_str)
        .ok_or("No active project folder")?;
    let trash = fs::canonicalize(Path::new(root).join("Trash")).map_err(|e| e.to_string())?;
    let selected = fs::canonicalize(target).map_err(|e| e.to_string())?;
    if selected == trash || !selected.starts_with(&trash) {
        return Err("Only items inside the project's Trash can be deleted".into());
    }
    recycle(&selected)
}

/// Permanently removes a Trash item from the project by moving it to the system recycle bin.
#[tauri::command(async)]
pub fn delete_from_trash(app: AppHandle, path: String) -> Result<(), String> {
    let state_path = crate::config_root::path(&app)?
        .join(crate::config::STATE_FILE);
    recycle_from_trash_in(&state_path, Path::new(&path), |item| {
        trash::delete(item).map_err(|e| e.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grants_the_folder_of_a_document_the_user_already_picked() {
        let base = std::env::temp_dir().join(format!("grimoire-docfolder-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let notes = base.join("home/Notes");
        fs::create_dir_all(&notes).unwrap();
        fs::write(notes.join("chapter.md"), "# Chapter").unwrap();
        fs::write(base.join("home/loose.md"), "# Loose").unwrap();
        fs::write(notes.join("font.ttf"), "font").unwrap();
        let home = base.join("home");
        let canonical = |path: &Path| PathBuf::from(super::super::rename_references::portable(&fs::canonicalize(path).unwrap()).unwrap());

        // The grant is always the canonical folder, the one the guard checked.
        assert_eq!(document_folder(&notes.join("chapter.md"), true, Some(&home)).unwrap(), canonical(&notes));
        assert_eq!(
            document_folder(&notes.join("chapter.md"), false, Some(&home)).unwrap_err(),
            "Only a document you opened or saved can share its folder"
        );
        // Directly in home: only its assets/ folder, never the whole home.
        assert_eq!(document_folder(&home.join("loose.md"), true, Some(&home)).unwrap(), canonical(&home).join("assets"));
        assert_eq!(
            document_folder(&notes.join("font.ttf"), true, Some(&home)).unwrap_err(),
            "Only Markdown and text documents can share their folder"
        );
        assert!(document_folder(&notes, true, Some(&home)).is_err());
        assert!(document_folder(&notes.join("missing.md"), true, Some(&home)).is_err());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn workspace_rename_holds_the_session_lock_through_scope_grant_and_rollback() {
        let base = std::env::temp_dir().join(format!("grimoire-rename-state-lock-{}", std::process::id()));
        fs::create_dir_all(base.join("Old/Draft")).unwrap();
        let old = base.join("Old");
        let state_path = base.join("state.json");
        let raw = serde_json::json!({
            "lastWorkspace": normalize(&old.to_string_lossy()),
            "recentWorkspaces": [normalize(&old.to_string_lossy())],
            "lastFile": normalize(&old.join("Draft/chapter.md").to_string_lossy()),
            "settings": { "theme": "parchment" }
        }).to_string();
        fs::write(&state_path, &raw).unwrap();
        // A second session operation must not enter after the folder moved but before
        // the new state is published (or the folder and original state are restored).
        for fail_grant in [true, false] {
            let mut locked = false;
            let result = rename_workspace_in(&state_path, &old, "New", |_| {
                locked = matches!(
                    super::super::app_state::STATE_LOCK.try_lock(),
                    Err(std::sync::TryLockError::WouldBlock)
                );
                if fail_grant { Err("scope denied".into()) } else { Ok(()) }
            });
            assert!(locked, "workspace rename must hold the same lock as session reads and writes");
            if fail_grant {
                assert!(result.unwrap_err().contains("scope denied"));
                assert!(old.is_dir());
                assert!(!base.join("New").exists());
                assert_eq!(fs::read_to_string(&state_path).unwrap(), raw);
            } else {
                let next = result.unwrap();
                assert!(!old.exists());
                assert!(base.join("New/Draft").is_dir());
                let saved: Value = serde_json::from_str(&fs::read_to_string(&state_path).unwrap()).unwrap();
                assert_eq!(saved["lastWorkspace"], next);
                assert_eq!(saved["recentWorkspaces"][0], next);
                assert_eq!(saved["lastFile"], format!("{next}/Draft/chapter.md"));
                assert_eq!(saved["settings"]["theme"], "parchment");
            }
        }
        fs::remove_dir_all(base).unwrap();
    }

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
        let normalized_folder = normalize(&project.join("Draft/../Draft").to_string_lossy());
        let resolved = fs::canonicalize(project.join("Draft")).unwrap();
        let expected = PathBuf::from(super::super::rename_references::portable(&resolved).unwrap());
        open_folder_in(&state_path, Path::new(&normalized_folder), |folder| {
            launched = true;
            assert_eq!(folder, expected.components().collect::<PathBuf>());
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

    #[test]
    fn recycles_only_items_inside_the_active_projects_trash() {
        let base = std::env::temp_dir().join(format!("grimoire-recycle-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let project = base.join("Book");
        fs::create_dir_all(project.join("Trash")).unwrap();
        fs::create_dir_all(project.join("Draft")).unwrap();
        fs::write(project.join("Trash/old.md"), "x").unwrap();
        fs::write(project.join("Draft/keep.md"), "x").unwrap();
        let state_path = base.join("state.json");
        fs::write(&state_path, format!("{{\"lastWorkspace\": {:?}}}", project.to_string_lossy())).unwrap();

        let mut recycled = Vec::new();
        recycle_from_trash_in(&state_path, &project.join("Trash/old.md"), |item| {
            recycled.push(item.to_path_buf());
            Ok(())
        })
        .unwrap();
        assert_eq!(recycled.len(), 1);
        for refused in [project.join("Draft/keep.md"), project.join("Trash"), project.join("Trash/../Draft/keep.md")] {
            assert!(recycle_from_trash_in(&state_path, &refused, |_| panic!("must not recycle")).is_err());
        }
        fs::remove_dir_all(&base).unwrap();
    }
}
