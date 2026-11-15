//! `state.json` belongs to Rust. Its `lastWorkspace` and `recentWorkspaces` decide which
//! folder Git, replace, the terminal and `restore_workspace` may touch, so the page can no
//! longer write the file directly (`config_root::init` forbids it in the fs scope). The page
//! reads and writes it through these commands, and Rust accepts a project path only when it
//! was already remembered or is a folder the user granted in this session.
use std::fs;
use std::path::Path;
use std::sync::Mutex;

use serde_json::{Map, Value};
use tauri::AppHandle;
use tauri_plugin_fs::FsExt;

const MAX_RECENT: usize = 6;

/// Serialises the read-modify-write of `state.json` between these commands.
static STATE_LOCK: Mutex<()> = Mutex::new(());

fn normalize(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_string()
}

fn remembered(previous: &Value) -> Vec<String> {
    let mut known: Vec<String> = previous
        .get("recentWorkspaces")
        .and_then(Value::as_array)
        .map(|list| list.iter().filter_map(Value::as_str).map(normalize).collect())
        .unwrap_or_default();
    if let Some(last) = previous.get("lastWorkspace").and_then(Value::as_str) {
        known.push(normalize(last));
    }
    known
}

/// Checks a state the page wants to save against the one on disk. A project path is
/// accepted when it was already remembered, or when it is a folder the page may read
/// (picked in the folder dialog, or created inside one). Removing paths is always allowed.
fn accept_state(
    previous: &Value,
    next: Value,
    granted: impl Fn(&Path) -> bool,
    config_root: &Path,
) -> Result<Value, String> {
    let Value::Object(mut next) = next else {
        return Err("The session state must be an object".into());
    };
    let known = remembered(previous);
    let config = fs::canonicalize(config_root).unwrap_or_else(|_| config_root.to_path_buf());
    let check = |path: &str| -> Result<String, String> {
        // Git would then run in the settings folder and could restore a state.json the page wrote.
        let candidate = fs::canonicalize(path).unwrap_or_else(|_| Path::new(path).to_path_buf());
        if candidate.starts_with(&config) || config.starts_with(&candidate) {
            return Err(format!("\"{path}\" holds the app settings and cannot be a project"));
        }
        let normal = normalize(path);
        if known.contains(&normal) || (Path::new(path).is_dir() && granted(Path::new(path))) {
            Ok(path.to_string())
        } else {
            Err(format!("\"{path}\" is not a project folder you opened"))
        }
    };
    let last = match next.get("lastWorkspace") {
        None | Some(Value::Null) => Value::Null,
        Some(Value::String(path)) => Value::String(check(path)?),
        Some(_) => return Err("lastWorkspace must be a path or null".into()),
    };
    let recent = match next.get("recentWorkspaces") {
        None => Vec::new(),
        Some(Value::Array(list)) => list
            .iter()
            .map(|item| item.as_str().ok_or("recentWorkspaces must list paths".to_string()).and_then(check))
            .collect::<Result<Vec<_>, _>>()?,
        Some(_) => return Err("recentWorkspaces must be a list".into()),
    };
    next.insert("lastWorkspace".into(), last);
    next.insert(
        "recentWorkspaces".into(),
        Value::Array(recent.into_iter().take(MAX_RECENT).map(Value::String).collect()),
    );
    Ok(Value::Object(next))
}

fn read_in(path: &Path) -> Value {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| Value::Object(Map::new()))
}

fn write_in(path: &Path, next: Value, granted: impl Fn(&Path) -> bool, config_root: &Path) -> Result<Value, String> {
    let _guard = STATE_LOCK.lock().map_err(|_| "Session state lock unavailable")?;
    let accepted = accept_state(&read_in(path), next, granted, config_root)?;
    let raw = serde_json::to_string_pretty(&accepted).map_err(|e| e.to_string())?;
    // Write beside the file and rename, so a crash never leaves half a state behind.
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, raw).map_err(|e| e.to_string())?;
    fs::rename(&temporary, path).map_err(|e| e.to_string())?;
    Ok(accepted)
}

/// The saved session, or an empty object when the file is missing or unreadable.
#[tauri::command(async)]
pub fn read_app_state(app: AppHandle) -> Result<Value, String> {
    let path = crate::config_root::path(&app)?.join(crate::config::STATE_FILE);
    let _guard = STATE_LOCK.lock().map_err(|_| "Session state lock unavailable")?;
    Ok(read_in(&path))
}

/// Saves the session and returns what was stored.
#[tauri::command(async)]
pub fn write_app_state(app: AppHandle, state: Value) -> Result<Value, String> {
    let root = crate::config_root::path(&app)?;
    let scope = app.fs_scope();
    write_in(&root.join(crate::config::STATE_FILE), state, |folder| scope.is_allowed(folder), &root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct Scratch(std::path::PathBuf);
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// A config root unrelated to the scratch projects.
    fn outside_config() -> std::path::PathBuf {
        std::env::temp_dir().join("grimoire-app-state-tests-config")
    }

    fn scratch() -> (Scratch, String, String) {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let base = std::env::temp_dir().join(format!(
            "grimoire-app-state-tests-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(base.join("book")).unwrap();
        fs::create_dir_all(base.join("other")).unwrap();
        let book = normalize(base.join("book").to_str().unwrap());
        let other = normalize(base.join("other").to_str().unwrap());
        (Scratch(base), book, other)
    }

    #[test]
    fn remembers_a_folder_the_user_opened_and_keeps_the_other_fields() {
        let (_base, book, _) = scratch();
        let granted = |path: &Path| normalize(path.to_str().unwrap()) == book;
        let next = json!({ "lastWorkspace": book, "recentWorkspaces": [book], "lastFile": format!("{book}/a.md"), "settings": { "zoom": 2 } });
        assert_eq!(accept_state(&json!({}), next.clone(), granted, &outside_config()).unwrap(), next);
    }

    #[test]
    fn refuses_a_folder_the_user_never_opened() {
        let (_base, book, other) = scratch();
        let previous = json!({ "lastWorkspace": book, "recentWorkspaces": [book] });
        let message = format!("\"{other}\" is not a project folder you opened");
        assert_eq!(accept_state(&previous, json!({ "lastWorkspace": other, "recentWorkspaces": [book] }), |_| false, &outside_config()).unwrap_err(), message);
        assert_eq!(accept_state(&previous, json!({ "lastWorkspace": book, "recentWorkspaces": [book, other] }), |_| false, &outside_config()).unwrap_err(), message);
        assert!(accept_state(&previous, json!({ "lastWorkspace": "C:/", "recentWorkspaces": [] }), |_| false, &outside_config()).is_err());
    }

    #[test]
    fn keeps_remembered_folders_even_when_they_are_not_granted_yet() {
        let (_base, book, other) = scratch();
        let previous = json!({ "lastWorkspace": other, "recentWorkspaces": [other, book] });
        let next = json!({ "lastWorkspace": book.replace('/', "\\"), "recentWorkspaces": [book, other] });
        assert!(accept_state(&previous, next, |_| false, &outside_config()).is_ok());
    }

    #[test]
    fn always_lets_the_page_forget_projects() {
        let (_base, book, _) = scratch();
        let previous = json!({ "lastWorkspace": book, "recentWorkspaces": [book] });
        let next = json!({ "lastWorkspace": null, "recentWorkspaces": [], "lastFile": null });
        assert_eq!(accept_state(&previous, next.clone(), |_| false, &outside_config()).unwrap(), next);
    }

    #[test]
    fn rejects_malformed_states_and_caps_the_recent_list() {
        let (_base, book, _) = scratch();
        assert!(accept_state(&json!({}), json!([]), |_| true, &outside_config()).is_err());
        assert!(accept_state(&json!({}), json!({ "lastWorkspace": 3 }), |_| true, &outside_config()).is_err());
        assert!(accept_state(&json!({}), json!({ "recentWorkspaces": [1] }), |_| true, &outside_config()).is_err());
        let many = json!({ "recentWorkspaces": vec![book.clone(); 9] });
        assert_eq!(accept_state(&json!({}), many, |_| true, &outside_config()).unwrap()["recentWorkspaces"].as_array().unwrap().len(), MAX_RECENT);
    }

    #[test]
    fn never_accepts_the_config_folder_or_a_folder_around_it_as_a_project() {
        let (base, book, _) = scratch();
        let config = base.0.join("book/config");
        fs::create_dir_all(config.join("Mods")).unwrap();
        let config_text = normalize(config.to_str().unwrap());
        let inside = format!("{config_text}/Mods");
        // Granted (the config root is allowed recursively) and even already remembered.
        let previous = json!({ "lastWorkspace": config_text, "recentWorkspaces": [config_text, inside, book] });
        for path in [&config_text, &inside, &book] {
            assert_eq!(
                accept_state(&previous, json!({ "lastWorkspace": path, "recentWorkspaces": [] }), |_| true, &config).unwrap_err(),
                format!("\"{path}\" holds the app settings and cannot be a project")
            );
        }
    }

    #[test]
    fn writes_only_accepted_states_to_disk() {
        let (base, book, other) = scratch();
        let path = base.0.join("state.json");
        let granted = |p: &Path| normalize(p.to_str().unwrap()) == book;
        write_in(&path, json!({ "lastWorkspace": book, "recentWorkspaces": [book] }), granted, &outside_config()).unwrap();
        let saved = fs::read(&path).unwrap();
        assert!(write_in(&path, json!({ "lastWorkspace": other, "recentWorkspaces": [other] }), granted, &outside_config()).is_err());
        assert_eq!(fs::read(&path).unwrap(), saved);
        assert_eq!(read_in(&path)["lastWorkspace"], json!(book));
        assert_eq!(read_in(&base.0.join("missing.json")), json!({}));
    }
}
