use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{AppHandle, Manager};

/// This command has no renderer-selected path and does not weaken workspace folder guards.
fn mods_folder(config: &Path) -> Result<PathBuf, String> {
    let folder = config.join("Mods");
    let info = fs::symlink_metadata(&folder).map_err(|error| error.to_string())?;
    if !info.is_dir() || info.file_type().is_symlink() {
        return Err("Mods must be a regular directory".into());
    }
    let base = fs::canonicalize(config).map_err(|error| error.to_string())?;
    let resolved = fs::canonicalize(&folder).map_err(|error| error.to_string())?;
    if resolved.parent() != Some(base.as_path()) {
        return Err("Mods must remain inside application configuration".into());
    }
    Ok(resolved)
}

#[tauri::command]
pub fn open_mods_folder(app: AppHandle) -> Result<(), String> {
    let config = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    let folder = mods_folder(&config)?;
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
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn opens_only_a_real_mods_directory() {
        let root = std::env::temp_dir().join(format!(
            "grimoire-mod-folder-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        assert!(mods_folder(&root).is_err());
        fs::write(root.join("Mods"), "not a folder").unwrap();
        assert!(mods_folder(&root).is_err());
        fs::remove_file(root.join("Mods")).unwrap();
        fs::create_dir(root.join("Mods")).unwrap();
        assert_eq!(
            mods_folder(&root).unwrap(),
            fs::canonicalize(root.join("Mods")).unwrap()
        );
        fs::remove_dir_all(root).unwrap();
    }
}
