//! First-run and repair of the app config folder.
//!
//! Runs on every launch, whether from the installer or a portable exe, so the
//! frontend can assume the folder layout exists.
use std::fs;
use std::io;
use std::path::Path;

use tauri::{AppHandle, Manager};

pub const STATE_FILE: &str = "state.json";
const BACKUP_FILE: &str = "state.json.bak";
/// Folders users drop mods into.
const SUBDIRS: [&str; 2] = ["themes", "templates"];
const DEFAULT_STATE: &str = r#"{
  "lastWorkspace": null,
  "recentWorkspaces": [],
  "lastFile": null,
  "settings": {}
}
"#;

fn is_valid_state(raw: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(raw).is_ok_and(|v| v.is_object())
}

/// Creates whatever is missing under `dir`. A `state.json` that is not a JSON
/// object is kept as `state.json.bak` and replaced, so nothing is lost silently.
pub fn ensure_in(dir: &Path) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    for sub in SUBDIRS {
        fs::create_dir_all(dir.join(sub))?;
    }

    let state = dir.join(STATE_FILE);
    match fs::read_to_string(&state) {
        Ok(raw) if is_valid_state(&raw) => Ok(()),
        Ok(_) => {
            fs::rename(&state, dir.join(BACKUP_FILE))?;
            fs::write(&state, DEFAULT_STATE)
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => fs::write(&state, DEFAULT_STATE),
        Err(e) => Err(e),
    }
}

/// A config folder that cannot be written must not stop the app from starting,
/// so failures are reported and swallowed.
pub fn ensure(app: &AppHandle) {
    let result = app
        .path()
        .app_config_dir()
        .map_err(|e| io::Error::other(e.to_string()))
        .and_then(|dir| ensure_in(&dir));
    if let Err(e) = result {
        eprintln!("could not prepare the config folder: {e}");
        crate::commands::error_logs::best_effort("native.config", &e.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("grimoire-config-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn creates_the_whole_layout_on_first_run() {
        let dir = scratch("first-run");
        ensure_in(&dir).unwrap();
        assert!(dir.join("themes").is_dir());
        assert!(dir.join("templates").is_dir());
        assert!(is_valid_state(&fs::read_to_string(dir.join(STATE_FILE)).unwrap()));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn keeps_a_valid_existing_state_untouched() {
        let dir = scratch("keep");
        fs::create_dir_all(&dir).unwrap();
        let saved = r#"{"lastWorkspace":"H:/Books","recentWorkspaces":["H:/Books"]}"#;
        fs::write(dir.join(STATE_FILE), saved).unwrap();
        ensure_in(&dir).unwrap();
        assert_eq!(fs::read_to_string(dir.join(STATE_FILE)).unwrap(), saved);
        assert!(!dir.join(BACKUP_FILE).exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn replaces_a_corrupt_state_and_keeps_a_backup() {
        let dir = scratch("corrupt");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(STATE_FILE), "{ not json").unwrap();
        ensure_in(&dir).unwrap();
        assert!(is_valid_state(&fs::read_to_string(dir.join(STATE_FILE)).unwrap()));
        assert_eq!(fs::read_to_string(dir.join(BACKUP_FILE)).unwrap(), "{ not json");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn recreates_a_deleted_mods_folder() {
        let dir = scratch("missing-subdir");
        ensure_in(&dir).unwrap();
        fs::remove_dir(dir.join("themes")).unwrap();
        ensure_in(&dir).unwrap();
        assert!(dir.join("themes").is_dir());
        fs::remove_dir_all(dir).unwrap();
    }
}
