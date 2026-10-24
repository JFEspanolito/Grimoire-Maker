//! Native-owned library selection. Renderer arguments never authorize arbitrary paths.
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;

static CHANGES: Mutex<()> = Mutex::new(());
const PREFERENCES_FILE: &str = "setting.json";

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LibraryKind {
    Plugins,
    Snippets,
    Templates,
    Themes,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct LibraryPaths {
    plugins: String,
    snippets: String,
    templates: String,
    themes: String,
}

impl LibraryPaths {
    fn get_mut(&mut self, kind: LibraryKind) -> &mut String {
        match kind {
            LibraryKind::Plugins => &mut self.plugins,
            LibraryKind::Snippets => &mut self.snippets,
            LibraryKind::Templates => &mut self.templates,
            LibraryKind::Themes => &mut self.themes,
        }
    }
    fn all(&self) -> [&str; 4] {
        [&self.plugins, &self.snippets, &self.templates, &self.themes]
    }
}

fn text(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(|p| p.replace('\\', "/"))
        .ok_or_else(|| "Directory path is not valid Unicode".into())
}
fn metadata(path: &Path) -> Result<fs::Metadata, String> {
    let info = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    reject_special(&info)?;
    Ok(info)
}
fn reject_special(info: &fs::Metadata) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if info.file_attributes() & 0x400 != 0 {
            return Err("Links and reparse points are not supported".into());
        }
    }
    if info.file_type().is_symlink() || !(info.is_dir() || info.is_file()) {
        return Err("Links and special files are not supported".into());
    }
    Ok(())
}

/// Windows handles deny rename/delete while paths are in use and open reparse points themselves.
fn open_checked(path: &Path, directory: bool) -> Result<File, String> {
    let before = metadata(path)?;
    if before.is_dir() != directory {
        return Err("Expected a regular directory or file".into());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000 | if directory { 0x02000000 } else { 0 });
        options.share_mode(if directory { 3 } else { 1 });
    }
    let file = options.open(path).map_err(|e| e.to_string())?;
    let after = file.metadata().map_err(|e| e.to_string())?;
    reject_special(&after)?;
    if after.is_dir() != directory {
        return Err("Directory changed during access".into());
    }
    Ok(file)
}

fn lock_ancestors(path: &Path, locks: &mut Vec<File>) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("Library paths must be absolute".into());
    }
    for ancestor in path.ancestors().collect::<Vec<_>>().into_iter().rev() {
        locks.push(open_checked(ancestor, true)?);
    }
    Ok(())
}

#[derive(Clone, Default, Deserialize, Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UserSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    page_size: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    columns: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    theme: Option<String>,
}

impl UserSettings {
    fn validate(&self) -> Result<(), String> {
        if self.columns.is_some_and(|value| value != 1 && value != 2) {
            return Err("Columns must be 1 or 2".into());
        }
        Ok(())
    }
}

#[derive(Deserialize, Serialize)]
struct Preferences {
    paths: LibraryPaths,
    #[serde(default)]
    settings: UserSettings,
    #[serde(flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
}

fn read_json(path: &Path) -> Result<Option<serde_json::Value>, String> {
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
        Ok(_) => {
            let mut handle = open_checked(path, false)?;
            if handle.metadata().map_err(|e| e.to_string())?.len() > 64 * 1024 {
                return Err("Preferences exceed 64 KiB".into());
            }
            let mut raw = String::new();
            handle.read_to_string(&mut raw).map_err(|e| e.to_string())?;
            serde_json::from_str(&raw)
                .map(Some)
                .map_err(|e| format!("Invalid preferences: {e}"))
        }
    }
}

fn default_paths(config: &Path) -> Result<LibraryPaths, String> {
    let mut locks = Vec::new();
    for relative in [
        "Mods",
        "Mods/Plugins",
        "Mods/Snippets",
        "Mods/Templates",
        "themes",
    ] {
        let path = config.join(relative);
        if let Err(e) = fs::create_dir(&path) {
            if e.kind() != std::io::ErrorKind::AlreadyExists {
                return Err(e.to_string());
            }
        }
        locks.push(open_checked(&path, true)?);
    }
    Ok(LibraryPaths {
        plugins: text(&config.join("Mods/Plugins"))?,
        snippets: text(&config.join("Mods/Snippets"))?,
        templates: text(&config.join("Mods/Templates"))?,
        themes: text(&config.join("themes"))?,
    })
}

// Callers hold CHANGES; internal helpers never acquire it recursively.
fn read_preferences(config: &Path) -> Result<Preferences, String> {
    let mut locks = Vec::new();
    lock_ancestors(config, &mut locks)?;
    if let Some(raw) = read_json(&config.join(PREFERENCES_FILE))? {
        let preferences: Preferences =
            serde_json::from_value(raw).map_err(|e| format!("Invalid preferences: {e}"))?;
        preferences.settings.validate()?;
        return Ok(preferences);
    }
    let paths = match read_json(&config.join("library-paths.json"))? {
        Some(raw) => {
            serde_json::from_value(raw).map_err(|e| format!("Invalid legacy paths: {e}"))?
        }
        None => default_paths(config)?,
    };
    let settings =
        match read_json(&config.join("state.json"))?.and_then(|raw| raw.get("settings").cloned()) {
            Some(raw) => {
                serde_json::from_value(raw).map_err(|e| format!("Invalid legacy settings: {e}"))?
            }
            None => UserSettings::default(),
        };
    let preferences = Preferences {
        paths,
        settings,
        extra: Default::default(),
    };
    preferences.settings.validate()?;
    publish_preferences(config, &preferences)?;
    // Read the authoritative file back before reporting a successful migration.
    read_preferences(config)
}

fn read_paths(config: &Path) -> Result<LibraryPaths, String> {
    let paths = read_preferences(config)?.paths;
    let mut locks = Vec::new();
    for path in paths.all() {
        lock_ancestors(Path::new(path), &mut locks)?;
    }
    Ok(paths)
}

fn save_settings_in(config: &Path, settings: UserSettings) -> Result<(), String> {
    settings.validate()?;
    let mut preferences = read_preferences(config)?;
    preferences.settings = settings;
    publish_preferences(config, &preferences)
}

struct CopyEntry {
    relative: PathBuf,
    source: Option<File>,
}
fn inventory(
    root: &Path,
    relative: &Path,
    entries: &mut Vec<CopyEntry>,
    locks: &mut Vec<File>,
) -> Result<(), String> {
    for child in fs::read_dir(root.join(relative)).map_err(|e| e.to_string())? {
        let child = child.map_err(|e| e.to_string())?;
        let relative = relative.join(child.file_name());
        let path = root.join(&relative);
        if metadata(&path)?.is_dir() {
            locks.push(open_checked(&path, true)?);
            entries.push(CopyEntry {
                relative: relative.clone(),
                source: None,
            });
            inventory(root, &relative, entries, locks)?;
        } else {
            entries.push(CopyEntry {
                relative,
                source: Some(open_checked(&path, false)?),
            });
        }
    }
    Ok(())
}

fn publish(config: &Path, paths: &LibraryPaths) -> Result<(), String> {
    let mut preferences = read_preferences(config)?;
    preferences.paths = paths.clone();
    publish_preferences(config, &preferences)
}

fn publish_preferences(config: &Path, preferences: &Preferences) -> Result<(), String> {
    let mut locks = Vec::new();
    lock_ancestors(config, &mut locks)?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let temporary = config.join(format!(".setting-{}-{stamp}.tmp", std::process::id()));
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|e| e.to_string())?;
    let raw = serde_json::to_vec_pretty(preferences).map_err(|e| e.to_string())?;
    output
        .write_all(&raw)
        .and_then(|_| output.sync_all())
        .map_err(|e| e.to_string())?;
    drop(output);
    // Rename atomically replaces on Windows and Unix. Never remove/truncate the old preferences first.
    fs::rename(&temporary, config.join(PREFERENCES_FILE)).map_err(|e| e.to_string())
}

fn change_in(
    config: &Path,
    kind: LibraryKind,
    destination: &Path,
    grant: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<LibraryPaths, String> {
    let mut paths = read_paths(config)?;
    let source = PathBuf::from(paths.get_mut(kind).clone());
    let mut locks = Vec::new();
    lock_ancestors(config, &mut locks)?;
    lock_ancestors(&source, &mut locks)?;
    lock_ancestors(destination, &mut locks)?;
    let source = fs::canonicalize(&source).map_err(|e| e.to_string())?;
    let destination = fs::canonicalize(destination).map_err(|e| e.to_string())?;
    if destination.starts_with(&source) || source.starts_with(&destination) {
        return Err("Source and destination must not be equal, ancestors or descendants".into());
    }
    for active in paths.all() {
        let active = fs::canonicalize(active).map_err(|e| e.to_string())?;
        if destination.starts_with(&active) || active.starts_with(&destination) {
            return Err("Destination overlaps an active library".into());
        }
    }
    let mut entries = Vec::new();
    inventory(&source, Path::new(""), &mut entries, &mut locks)?;
    for entry in &entries {
        match fs::symlink_metadata(destination.join(&entry.relative)) {
            Ok(_) => {
                return Err(format!(
                    "Destination already contains {}",
                    entry.relative.display()
                ))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(e.to_string()),
        }
    }
    for mut entry in entries {
        let target = destination.join(&entry.relative);
        if let Some(ref mut input) = entry.source {
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)
                .map_err(|e| e.to_string())?;
            std::io::copy(input, &mut output)
                .and_then(|_| output.sync_all())
                .map_err(|e| e.to_string())?;
        } else {
            fs::create_dir(&target).map_err(|e| e.to_string())?;
            locks.push(open_checked(&target, true)?);
        }
    }
    grant(&destination)?;
    *paths.get_mut(kind) = text(&destination)?;
    publish(config, &paths)?;
    Ok(paths)
}

pub fn restore_scopes(app: &AppHandle) -> Result<LibraryPaths, String> {
    let _guard = CHANGES.lock().map_err(|e| e.to_string())?;
    let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let paths = read_paths(&config)?;
    let mut locks = Vec::new();
    for path in paths.all() {
        lock_ancestors(Path::new(path), &mut locks)?;
        app.fs_scope()
            .allow_directory(path, true)
            .map_err(|e| e.to_string())?;
    }
    Ok(paths)
}

#[tauri::command]
pub async fn load_settings(app: AppHandle) -> Result<UserSettings, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = CHANGES.lock().map_err(|e| e.to_string())?;
        let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
        Ok(read_preferences(&config)?.settings)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: UserSettings) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = CHANGES.lock().map_err(|e| e.to_string())?;
        let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
        save_settings_in(&config, settings)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn load_library_paths(app: AppHandle) -> Result<LibraryPaths, String> {
    tauri::async_runtime::spawn_blocking(move || restore_scopes(&app))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn change_library_path(
    app: AppHandle,
    kind: LibraryKind,
) -> Result<Option<LibraryPaths>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = CHANGES.lock().map_err(|e| e.to_string())?;
        let Some(destination) = app
            .dialog()
            .file()
            .set_title("Copy library to directory")
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let destination = destination.into_path().map_err(|e| e.to_string())?;
        let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
        change_in(&config, kind, &destination, |path| {
            app.fs_scope()
                .allow_directory(path, true)
                .map_err(|e| e.to_string())
        })
        .map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod preferences_tests {
    use super::*;
    fn scratch(name: &str) -> PathBuf {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "grimoire-preferences-{name}-{}-{stamp}",
            std::process::id()
        ));
        fs::create_dir(&dir).unwrap();
        eprintln!("preferences scratch retained: {}", dir.display());
        dir
    }
    #[test]
    fn preferences_migrate_paths_and_appearance_to_standard_file() {
        let config = scratch("migration");
        let initial = read_paths(&config).unwrap();
        // Simulate an installation with only the previous settings files.
        if config.join("setting.json").exists() {
            fs::remove_file(config.join("setting.json")).unwrap();
        }
        fs::write(
            config.join("library-paths.json"),
            serde_json::to_vec(&initial).unwrap(),
        )
        .unwrap();
        let legacy = br#"{"lastWorkspace":"C:/book","settings":{"theme":"sci-fi","pageSize":"letter","columns":1}}"#;
        fs::write(config.join("state.json"), legacy).unwrap();
        assert_eq!(read_paths(&config).unwrap(), initial);
        let saved: serde_json::Value =
            serde_json::from_slice(&fs::read(config.join("setting.json")).unwrap()).unwrap();
        assert_eq!(saved["settings"]["theme"], "sci-fi");
        assert_eq!(saved["paths"], serde_json::to_value(&initial).unwrap());
        assert_eq!(fs::read(config.join("state.json")).unwrap(), legacy);
    }
    #[test]
    fn preferences_settings_and_paths_preserve_each_other_and_ignore_stale_legacy() {
        let config = scratch("shared-settings");
        let initial = read_paths(&config).unwrap();
        let settings = UserSettings {
            theme: Some("modern".into()),
            page_size: Some("a4".into()),
            columns: Some(2),
        };
        save_settings_in(&config, settings.clone()).unwrap();
        assert_eq!(read_paths(&config).unwrap(), initial);
        fs::write(
            config.join("state.json"),
            br#"{"settings":{"theme":"stale"}}"#,
        )
        .unwrap();
        fs::write(config.join("library-paths.json"), "invalid stale JSON").unwrap();
        let destination = config.join("new-snippets");
        fs::create_dir(&destination).unwrap();
        let updated = change_in(&config, LibraryKind::Snippets, &destination, |_| Ok(())).unwrap();
        assert_eq!(read_preferences(&config).unwrap().settings, settings);
        save_settings_in(
            &config,
            UserSettings {
                theme: Some("sci-fi".into()),
                ..settings
            },
        )
        .unwrap();
        assert_eq!(read_paths(&config).unwrap(), updated);
        assert_eq!(
            read_preferences(&config).unwrap().settings.theme.as_deref(),
            Some("sci-fi")
        );
    }
    #[test]
    fn preferences_failed_migration_and_invalid_updates_preserve_existing_bytes() {
        let config = scratch("migration-failure");
        let paths = default_paths(&config).unwrap();
        let legacy = serde_json::to_vec(&paths).unwrap();
        fs::write(config.join("library-paths.json"), &legacy).unwrap();
        fs::write(config.join("state.json"), "{bad").unwrap();
        assert!(read_preferences(&config).is_err());
        assert!(!config.join(PREFERENCES_FILE).exists());
        assert_eq!(fs::read(config.join("library-paths.json")).unwrap(), legacy);
        assert_eq!(
            fs::read_to_string(config.join("state.json")).unwrap(),
            "{bad"
        );
        fs::write(config.join("state.json"), "{}").unwrap();
        read_paths(&config).unwrap();
        let original = fs::read(config.join(PREFERENCES_FILE)).unwrap();
        assert!(save_settings_in(
            &config,
            UserSettings {
                columns: Some(3),
                ..Default::default()
            }
        )
        .is_err());
        assert_eq!(fs::read(config.join(PREFERENCES_FILE)).unwrap(), original);
        #[cfg(windows)]
        {
            let _held = open_checked(&config.join(PREFERENCES_FILE), false).unwrap();
            assert!(save_settings_in(
                &config,
                UserSettings {
                    theme: Some("modern".into()),
                    ..Default::default()
                }
            )
            .is_err());
            assert_eq!(fs::read(config.join(PREFERENCES_FILE)).unwrap(), original);
        }
    }
    #[test]
    fn preferences_copy_preserves_binary_hidden_empty_nested_and_originals() {
        let config = scratch("copy");
        let initial = read_paths(&config).unwrap();
        let source = Path::new(&initial.templates);
        fs::create_dir_all(source.join("book/.hidden/empty")).unwrap();
        fs::write(source.join("book/.hidden/map.bin"), [0, 255, 17, 128]).unwrap();
        let destination = config.join("custom");
        fs::create_dir(&destination).unwrap();
        let mut granted = false;
        let updated = change_in(&config, LibraryKind::Templates, &destination, |_| {
            granted = true;
            Ok(())
        })
        .unwrap();
        assert!(granted);
        assert_eq!(updated.plugins, initial.plugins);
        assert_eq!(read_paths(&config).unwrap(), updated);
        assert_eq!(
            fs::read(source.join("book/.hidden/map.bin")).unwrap(),
            [0, 255, 17, 128]
        );
        assert_eq!(
            fs::read(destination.join("book/.hidden/map.bin")).unwrap(),
            [0, 255, 17, 128]
        );
        assert!(destination.join("book/.hidden/empty").is_dir());
    }
    #[test]
    fn preferences_conflicts_and_overlap_preserve_active_config_and_source() {
        let config = scratch("conflict");
        let paths = read_paths(&config).unwrap();
        publish(&config, &paths).unwrap();
        let saved = fs::read(config.join(PREFERENCES_FILE)).unwrap();
        let source = Path::new(&paths.snippets);
        fs::write(source.join("note.md"), "original").unwrap();
        let destination = config.join("custom");
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("note.md"), "existing").unwrap();
        assert!(
            change_in(&config, LibraryKind::Snippets, &destination, |_| panic!(
                "must not grant"
            ))
            .is_err()
        );
        fs::create_dir(source.join("child")).unwrap();
        for invalid in [
            source.to_path_buf(),
            source.join("child"),
            source.parent().unwrap().to_path_buf(),
            PathBuf::from(&paths.themes),
            config.join("missing"),
        ] {
            assert!(
                change_in(&config, LibraryKind::Snippets, &invalid, |_| panic!(
                    "must not grant"
                ))
                .is_err()
            );
        }
        assert_eq!(fs::read(config.join(PREFERENCES_FILE)).unwrap(), saved);
        assert_eq!(
            fs::read_to_string(source.join("note.md")).unwrap(),
            "original"
        );
        assert_eq!(
            fs::read_to_string(destination.join("note.md")).unwrap(),
            "existing"
        );
    }
    #[test]
    fn preferences_scope_failure_and_publish_failure_leave_previous_file_intact() {
        let config = scratch("publish");
        let paths = read_paths(&config).unwrap();
        publish(&config, &paths).unwrap();
        let saved = fs::read(config.join(PREFERENCES_FILE)).unwrap();
        let destination = config.join("custom");
        fs::create_dir(&destination).unwrap();
        assert!(
            change_in(&config, LibraryKind::Plugins, &destination, |_| Err(
                "scope denied".into()
            ))
            .is_err()
        );
        assert_eq!(fs::read(config.join(PREFERENCES_FILE)).unwrap(), saved);
        // Holding the destination preference file without delete sharing forces atomic rename failure on Windows.
        #[cfg(windows)]
        {
            let _held = open_checked(&config.join(PREFERENCES_FILE), false).unwrap();
            assert!(change_in(&config, LibraryKind::Plugins, &destination, |_| Ok(())).is_err());
            assert_eq!(fs::read(config.join(PREFERENCES_FILE)).unwrap(), saved);
        }
    }
    #[test]
    fn preferences_all_categories_persist_without_interpreting_plugin_bytes() {
        let config = scratch("categories");
        let initial = read_paths(&config).unwrap();
        fs::write(
            Path::new(&initial.plugins).join("evil.js"),
            "throw Error('must not execute')",
        )
        .unwrap();
        for (index, kind) in [
            LibraryKind::Plugins,
            LibraryKind::Snippets,
            LibraryKind::Templates,
            LibraryKind::Themes,
        ]
        .into_iter()
        .enumerate()
        {
            let destination = config.join(format!("custom-{index}"));
            fs::create_dir(&destination).unwrap();
            let changed = change_in(&config, kind, &destination, |_| Ok(())).unwrap();
            assert_eq!(read_paths(&config).unwrap(), changed);
        }
        assert_eq!(
            fs::read(config.join("custom-0/evil.js")).unwrap(),
            fs::read(Path::new(&initial.plugins).join("evil.js")).unwrap()
        );
    }
    #[test]
    fn preferences_reject_links_before_copying() {
        let config = scratch("link");
        let paths = read_paths(&config).unwrap();
        publish(&config, &paths).unwrap();
        let saved = fs::read(config.join(PREFERENCES_FILE)).unwrap();
        let outside = config.join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("secret"), "private").unwrap();
        let link = Path::new(&paths.templates).join("linked");
        #[cfg(windows)]
        {
            // Junction creation does not require developer mode or symlink privilege.
            let result = std::process::Command::new("cmd")
                .args(["/c", "mklink", "/J"])
                .arg(link.to_string_lossy().replace('/', "\\"))
                .arg(&outside)
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        let destination = config.join("custom");
        fs::create_dir(&destination).unwrap();
        assert!(
            change_in(&config, LibraryKind::Templates, &destination, |_| panic!(
                "must not grant"
            ))
            .is_err()
        );
        assert_eq!(fs::read_dir(destination).unwrap().count(), 0);
        assert_eq!(fs::read(config.join(PREFERENCES_FILE)).unwrap(), saved);
        assert_eq!(
            fs::read_to_string(outside.join("secret")).unwrap(),
            "private"
        );
    }
    #[test]
    fn preferences_malformed_file_does_not_reset_to_defaults() {
        let config = scratch("invalid");
        fs::write(config.join(PREFERENCES_FILE), "{bad").unwrap();
        assert!(read_paths(&config).is_err());
        assert_eq!(
            fs::read_to_string(config.join(PREFERENCES_FILE)).unwrap(),
            "{bad"
        );
    }
    #[test]
    fn preferences_concurrent_path_and_settings_preserve_migration_bytes() {
        let config = scratch("concurrent");
        let original;
        let legacy_paths;
        let legacy_state = br#"{"lastWorkspace":"C:/book","settings":{"theme":"modern","columns":1,"pageSize":"letter"}}"#;
        {
            let _guard = CHANGES.lock().unwrap();
            original = default_paths(&config).unwrap();
            legacy_paths = serde_json::to_vec(&original).unwrap();
            fs::write(config.join("library-paths.json"), &legacy_paths).unwrap();
            fs::write(config.join("state.json"), legacy_state).unwrap();
            let migrated = read_preferences(&config).unwrap();
            assert_eq!(migrated.settings.theme.as_deref(), Some("modern"));
            fs::write(
                Path::new(&original.templates).join("custom.md"),
                "# Preserved content",
            )
            .unwrap();
        }
        let destination = config.join("new-templates");
        fs::create_dir(&destination).unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
        let path_thread = {
            let config = config.clone();
            let destination = destination.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                let _guard = CHANGES.lock().unwrap();
                change_in(&config, LibraryKind::Templates, &destination, |_| Ok(())).unwrap();
            })
        };
        let settings_thread = {
            let config = config.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                let _guard = CHANGES.lock().unwrap();
                save_settings_in(
                    &config,
                    UserSettings {
                        theme: Some("sci-fi".into()),
                        columns: Some(2),
                        page_size: Some("letter".into()),
                    },
                )
                .unwrap();
            })
        };
        barrier.wait();
        path_thread.join().unwrap();
        settings_thread.join().unwrap();
        let _guard = CHANGES.lock().unwrap();
        let final_value = read_preferences(&config).unwrap();
        assert_eq!(
            final_value.paths.templates,
            text(&fs::canonicalize(&destination).unwrap()).unwrap()
        );
        assert_eq!(final_value.paths.plugins, original.plugins);
        assert_eq!(final_value.settings.theme.as_deref(), Some("sci-fi"));
        assert_eq!(final_value.settings.columns, Some(2));
        assert_eq!(final_value.settings.page_size.as_deref(), Some("letter"));
        assert_eq!(
            fs::read(config.join("library-paths.json")).unwrap(),
            legacy_paths
        );
        assert_eq!(fs::read(config.join("state.json")).unwrap(), legacy_state);
        assert_eq!(
            fs::read(destination.join("custom.md")).unwrap(),
            b"# Preserved content"
        );
        assert_eq!(
            fs::read(Path::new(&original.templates).join("custom.md")).unwrap(),
            b"# Preserved content"
        );
        fs::write(config.join("library-paths.json"), "stale invalid legacy").unwrap();
        fs::write(config.join("state.json"), "stale invalid legacy").unwrap();
        assert_eq!(
            read_preferences(&config).unwrap().settings,
            final_value.settings
        );
    }
}
