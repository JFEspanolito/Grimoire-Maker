use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use serde::Deserialize;
use tauri::AppHandle;

use super::preferences::{restore_scopes_locked, CHANGES};

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
    let config = crate::config_root::path(&app)?;
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

/// The mod kinds stored as one folder per mod. Themes are single `.css` files and keep using `delete_user_theme`.
#[derive(Clone, Copy, Debug, Deserialize)]
pub enum ModKind {
    Snippets,
    Templates,
    Plugins,
}

const RESERVED: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// A mod name must be exactly one plain folder name: no separators, no drive or stream syntax,
/// no dot names, no Windows device names and no 8.3 short-name alias (`PROGRA~1`).
fn safe_segment(name: &str) -> Result<(), String> {
    let invalid = || Err("That mod name is not a valid folder name.".to_string());
    if name.is_empty()
        || name.chars().count() > 128
        || name.starts_with('.')
        || name.ends_with('.')
        || name.ends_with(' ')
    {
        return invalid();
    }
    if name
        .chars()
        .any(|c| c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
    {
        return invalid();
    }
    if name
        .as_bytes()
        .windows(2)
        .any(|pair| pair[0] == b'~' && pair[1].is_ascii_digit())
    {
        return invalid();
    }
    let stem = name.split('.').next().unwrap_or("").trim_end_matches(' ');
    let folded: String = stem
        .chars()
        .map(|c| match c {
            '\u{b9}' => '1',
            '\u{b2}' => '2',
            '\u{b3}' => '3',
            other => other,
        })
        .collect();
    if RESERVED.contains(&folded.to_ascii_lowercase().as_str()) {
        return invalid();
    }
    // The name must also be a single normal component for the platform's own parser.
    let mut parts = Path::new(name).components();
    match (parts.next(), parts.next()) {
        (Some(std::path::Component::Normal(_)), None) => Ok(()),
        _ => invalid(),
    }
}

/// Refuses any link, reparse point or special file anywhere in the tree, without following one.
fn ensure_plain_tree(root: &Path) -> Result<(), String> {
    const LIMIT: usize = 200_000;
    let mut seen = 0usize;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            seen += 1;
            if seen > LIMIT {
                return Err("This mod has too many files to delete safely.".into());
            }
            let info = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
            crate::safe_copy::reject_special(&info).map_err(|_| {
                "This mod contains a link or special file, so it was not deleted.".to_string()
            })?;
            if info.is_dir() {
                stack.push(entry.path());
            }
        }
    }
    Ok(())
}

/// Deletes the mod folder `name` directly inside `library` (the configured directory of one kind).
///
/// `remove_dir_all` is acceptable here only because every guard ran first: `name` is one safe
/// segment, the target is an existing real directory (not a link or reparse point) whose canonical
/// parent is the library itself, and the whole tree holds no link. std's `remove_dir_all` also
/// never follows links, so a link planted after the checks is removed, not traversed.
fn delete_mod_in(library: &Path, name: &str) -> Result<(), String> {
    safe_segment(name)?;
    let library_info = fs::symlink_metadata(library).map_err(|error| error.to_string())?;
    crate::safe_copy::reject_special(&library_info)?;
    if !library_info.is_dir() {
        return Err("The mods folder is not a directory.".into());
    }
    let library = fs::canonicalize(library).map_err(|error| error.to_string())?;
    let target = library.join(name);
    let info = match fs::symlink_metadata(&target) {
        Ok(info) => info,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err("That mod was already removed. Refresh the list.".into())
        }
        Err(error) => return Err(error.to_string()),
    };
    crate::safe_copy::reject_special(&info)
        .map_err(|_| "That mod is a link, so it was not deleted.".to_string())?;
    if !info.is_dir() {
        return Err("That mod is not a folder, so it was not deleted.".into());
    }
    let resolved = fs::canonicalize(&target).map_err(|error| error.to_string())?;
    if resolved == library || resolved.parent() != Some(library.as_path()) {
        return Err("That mod is outside the mods folder, so it was not deleted.".into());
    }
    ensure_plain_tree(&resolved)?;
    fs::remove_dir_all(&resolved).map_err(|error| error.to_string())
}

/// The configured directory of one mod kind, read from the serialized library paths.
fn library_for(paths: &serde_json::Value, kind: ModKind) -> Result<String, String> {
    let key = match kind {
        ModKind::Snippets => "snippets",
        ModKind::Templates => "templates",
        ModKind::Plugins => "plugins",
    };
    paths
        .get(key)
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .ok_or_else(|| "The library folder is not configured.".to_string())
}

/// Permanently deletes one snippet, template or plugin folder from its configured library directory.
#[tauri::command]
pub async fn delete_mod(app: AppHandle, kind: ModKind, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        // The library paths are read and the folder is deleted under one hold of the preferences lock,
        // so a library switch cannot slip in between and make this delete from the previous library.
        let _guard = CHANGES.lock().map_err(|error| error.to_string())?;
        let paths =
            serde_json::to_value(restore_scopes_locked(&app)?).map_err(|error| error.to_string())?;
        let library = library_for(&paths, kind)?;
        delete_mod_in(Path::new(&library), &name)
    })
    .await
    .map_err(|error| error.to_string())?
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

    fn scratch(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "grimoire-delete-mod-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    /// Creates a directory link (a junction on Windows). False when the platform refuses.
    fn link_dir(target: &Path, link: &Path) -> bool {
        #[cfg(windows)]
        {
            Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(link)
                .arg(target)
                .output()
                .map(|out| out.status.success())
                .unwrap_or(false)
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(target, link).is_ok()
        }
    }

    fn unlink_dir(link: &Path) {
        #[cfg(windows)]
        fs::remove_dir(link).unwrap();
        #[cfg(unix)]
        fs::remove_file(link).unwrap();
    }

    #[test]
    fn picks_the_library_of_the_requested_kind_and_refuses_a_missing_one() {
        let paths = serde_json::json!({
            "snippets": "C:/a/Snippets", "templates": "C:/a/Templates", "plugins": "C:/a/Plugins",
            "themes": "C:/a/Themes", "logs": "C:/a/Logs"
        });
        assert_eq!(library_for(&paths, ModKind::Snippets).unwrap(), "C:/a/Snippets");
        assert_eq!(library_for(&paths, ModKind::Templates).unwrap(), "C:/a/Templates");
        assert_eq!(library_for(&paths, ModKind::Plugins).unwrap(), "C:/a/Plugins");
        let missing = serde_json::json!({ "snippets": 3 });
        assert!(library_for(&missing, ModKind::Snippets).is_err());
        assert!(library_for(&missing, ModKind::Plugins).is_err());
    }

    #[test]
    fn a_library_switched_after_the_paths_were_read_would_delete_from_the_old_one() {
        // Documents why delete_mod reads the paths under the lock it deletes under: delete_mod_in trusts the
        // library it is handed, so a stale path deletes from the previous library.
        let root = scratch("switch");
        let old_library = root.join("Old");
        let new_library = root.join("New");
        fs::create_dir_all(old_library.join("mine")).unwrap();
        fs::create_dir_all(new_library.join("mine")).unwrap();
        delete_mod_in(&old_library, "mine").unwrap();
        assert!(new_library.join("mine").exists(), "the new library is untouched");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn deletes_one_real_mod_folder_and_nothing_else() {
        let root = scratch("happy");
        let library = root.join("Plugins");
        fs::create_dir_all(library.join("mine").join("src")).unwrap();
        fs::write(library.join("mine").join("src").join("a.ts"), "x").unwrap();
        fs::create_dir_all(library.join("keep")).unwrap();
        fs::write(library.join("keep").join("b.ts"), "y").unwrap();
        delete_mod_in(&library, "mine").unwrap();
        assert!(!library.join("mine").exists());
        assert!(library.join("keep").join("b.ts").exists());
        assert!(library.exists());
        assert!(delete_mod_in(&library, "mine").is_err(), "a missing folder is refused");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_names_that_are_not_one_plain_folder_name() {
        let root = scratch("names");
        let library = root.join("Snippets");
        fs::create_dir_all(library.join("ok")).unwrap();
        fs::create_dir_all(root.join("outside")).unwrap();
        let long = "x".repeat(200);
        for name in [
            "", ".", "..", "../outside", "..\\outside", "a/b", "a\\b", "ok/", "/ok", "C:", "C:ok",
            "C:\\x", "ok:stream", "ok::$DATA", "nul", "NUL", "con.txt", "COM1", "lpt9.md",
            "com\u{b9}", "ok.", "ok ", ".hidden", "PROGRA~1", "a*b", "a?b", "a|b", "a<b",
            "a\"b", "bad\u{0}name", "bad\nname", long.as_str(),
        ] {
            assert!(delete_mod_in(&library, name).is_err(), "{name:?} must be refused");
        }
        assert!(library.join("ok").exists());
        assert!(root.join("outside").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_the_library_root_files_and_unknown_kinds() {
        let root = scratch("root");
        let library = root.join("Templates");
        fs::create_dir_all(&library).unwrap();
        fs::write(library.join("plain.md"), "x").unwrap();
        assert!(delete_mod_in(&library, "Templates").is_err());
        assert!(delete_mod_in(&library, "plain.md").is_err(), "a file is not a mod folder");
        assert!(library.join("plain.md").exists());
        assert!(delete_mod_in(&root.join("missing-library"), "x").is_err());
        assert!(serde_json::from_str::<ModKind>("\"Plugins\"").is_ok());
        assert!(serde_json::from_str::<ModKind>("\"Themes\"").is_err());
        assert!(serde_json::from_str::<ModKind>("\"Logs\"").is_err());
        assert!(serde_json::from_str::<ModKind>("\"plugins\"").is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_a_linked_target_and_leaves_the_link_destination_alone() {
        let root = scratch("link");
        let library = root.join("Plugins");
        let outside = root.join("outside");
        fs::create_dir_all(&library).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("precious.txt"), "keep").unwrap();
        if !link_dir(&outside, &library.join("linked")) {
            eprintln!("directory links are not available here; skipping");
            fs::remove_dir_all(root).unwrap();
            return;
        }
        assert!(delete_mod_in(&library, "linked").is_err());
        assert!(outside.join("precious.txt").exists());
        assert!(fs::symlink_metadata(library.join("linked")).is_ok(), "the link is untouched");
        unlink_dir(&library.join("linked"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_a_mod_that_holds_a_nested_link() {
        let root = scratch("nested");
        let library = root.join("Plugins");
        let outside = root.join("outside");
        fs::create_dir_all(library.join("mine").join("deep")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("precious.txt"), "keep").unwrap();
        fs::write(library.join("mine").join("index.ts"), "x").unwrap();
        let inner = library.join("mine").join("deep").join("inner");
        if !link_dir(&outside, &inner) {
            eprintln!("directory links are not available here; skipping");
            fs::remove_dir_all(root).unwrap();
            return;
        }
        assert!(delete_mod_in(&library, "mine").is_err());
        assert!(library.join("mine").join("index.ts").exists(), "nothing was removed");
        assert!(outside.join("precious.txt").exists());
        unlink_dir(&inner);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_a_linked_library_directory() {
        let root = scratch("libink");
        let real = root.join("real");
        fs::create_dir_all(real.join("mine")).unwrap();
        let link = root.join("Library");
        if !link_dir(&real, &link) {
            eprintln!("directory links are not available here; skipping");
            fs::remove_dir_all(root).unwrap();
            return;
        }
        assert!(delete_mod_in(&link, "mine").is_err());
        assert!(real.join("mine").exists());
        unlink_dir(&link);
        fs::remove_dir_all(root).unwrap();
    }
}
