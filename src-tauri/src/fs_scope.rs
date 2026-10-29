//! Exact grants for app-owned dotfiles, keeping Unix hidden-file protection enabled.
use std::path::Path;
use tauri::scope::fs::Scope;
use tauri_plugin_fs::FsExt;

pub(crate) fn allow_owned_file(scope: &Scope, root: &Path, name: &str) -> Result<(), String> {
    let path = root.join(name);
    match std::fs::symlink_metadata(&path) {
        Ok(info) => {
            // allow_file also grants canonical paths: never follow a marker link to another file.
            if !info.is_file() || info.file_type().is_symlink() {
                return Err("App metadata must be a regular file".into());
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if info.file_attributes() & 0x400 != 0 {
                    return Err("App metadata cannot be a reparse point".into());
                }
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
        Err(error) => return Err(error.to_string()),
    }
    scope.allow_file(path).map_err(|error| error.to_string())
}

pub(crate) fn prepare_metadata(
    scope: &Scope,
    root: &Path,
    token: Option<&str>,
) -> Result<(), String> {
    if let Some(token) = token {
        if token.len() != 36
            || !token.bytes().enumerate().all(|(i, byte)| {
                if [8, 13, 18, 23].contains(&i) {
                    byte == b'-'
                } else {
                    byte.is_ascii_hexdigit()
                }
            })
        {
            return Err("Invalid metadata temporary-file token".into());
        }
    }
    if !root.is_absolute() || !root.is_dir() || !scope.is_allowed(root) {
        return Err("Forbidden project directory".into());
    }
    let canonical = std::fs::canonicalize(root).map_err(|error| error.to_string())?;
    if !scope.is_allowed(&canonical) {
        return Err("Forbidden project directory".into());
    }
    // Keep the caller's spelling; Tauri handles equivalent canonical paths itself.
    allow_owned_file(scope, root, ".grimoire-project.json")?;
    if let Some(token) = token {
        allow_owned_file(scope, root, &format!(".grimoire-project.json.{token}.tmp"))?;
    }
    Ok(())
}

/// Extends only an already authorized project directory, never arbitrary hidden paths.
#[tauri::command]
pub fn prepare_project_metadata(
    app: tauri::AppHandle,
    root: String,
    token: Option<String>,
) -> Result<(), String> {
    prepare_metadata(&app.fs_scope(), Path::new(&root), token.as_deref())
}
