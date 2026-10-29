//! Native-owned library selection. Renderer arguments never authorize arbitrary paths.
use crate::portable::{self, Hint, Mode};
use crate::safe_copy::{copy_entries, inventory, lock_ancestors, open_checked};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;

pub(super) static CHANGES: Mutex<()> = Mutex::new(());
const PREFERENCES_FILE: &str = "setting.json";
/// Top-level `setting.json` fields (kept through `Preferences::extra`).
const PORTABLE_ROOT: &str = "portableRoot";
const CONTENT_ROOT: &str = "contentRoot";
// Bound file size, not the number of visual guides. Reject oversized writes before replacement.
const MAX_PREFERENCES_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LibraryKind {
    Plugins,
    Snippets,
    Templates,
    Themes,
    Logs,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct LibraryPaths {
    plugins: String,
    snippets: String,
    templates: String,
    themes: String,
    logs: String,
}

impl LibraryPaths {
    fn get_mut(&mut self, kind: LibraryKind) -> &mut String {
        match kind {
            LibraryKind::Plugins => &mut self.plugins,
            LibraryKind::Snippets => &mut self.snippets,
            LibraryKind::Templates => &mut self.templates,
            LibraryKind::Themes => &mut self.themes,
            LibraryKind::Logs => &mut self.logs,
        }
    }
    fn all(&self) -> [&str; 5] {
        [
            &self.plugins,
            &self.snippets,
            &self.templates,
            &self.themes,
            &self.logs,
        ]
    }
}

fn text(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(|p| p.replace('\\', "/"))
        .ok_or_else(|| "Directory path is not valid Unicode".into())
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
    #[serde(skip_serializing_if = "Option::is_none")]
    ruler_guides: Option<Vec<RulerGuide>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    zoom: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    auto_save_seconds: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    auto_commit_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    auto_commit_minutes: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    auto_commit_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    panels: Option<Panels>,
}

/// Which side panels and overlays are shown; a missing entry keeps the app default.
#[derive(Clone, Default, Deserialize, Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Panels {
    #[serde(skip_serializing_if = "Option::is_none")]
    files: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    templates: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    snippets: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    git: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    properties: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    document_index: Option<bool>,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
enum GuideAxis {
    Row,
    Column,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RulerGuide {
    id: String,
    axis: GuideAxis,
    position_mm: f64,
}

impl UserSettings {
    fn validate(&self) -> Result<(), String> {
        if self.auto_commit_minutes.is_some_and(|value| !(1..=1440).contains(&value)) {
            return Err("Auto commit interval must be between 1 and 1440 minutes".into());
        }
        if self.auto_commit_message.as_ref().is_some_and(|message| message.trim().is_empty() || message.len() > 4096 || message.contains('\0')) {
            return Err("Provide an auto commit message of 1–4096 bytes without null characters".into());
        }
        if self
            .auto_save_seconds
            .is_some_and(|value| !(1..=86400).contains(&value))
        {
            return Err("Auto save interval must be between 1 and 86400 seconds".into());
        }
        if self
            .zoom
            .is_some_and(|value| !value.is_finite() || !(0.25..=3.0).contains(&value))
        {
            return Err("Zoom must be between 0.25 and 3".into());
        }
        if self.columns.is_some_and(|value| value != 1 && value != 2) {
            return Err("Columns must be 1 or 2".into());
        }
        let mut ids = std::collections::HashSet::new();
        for guide in self.ruler_guides.iter().flatten() {
            if guide.id.is_empty()
                || !ids.insert(&guide.id)
                || !guide.position_mm.is_finite()
                || guide.position_mm < 0.0
            {
                return Err("Guides require unique IDs and finite non-negative positions".into());
            }
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
            let maximum = if path
                .file_name()
                .is_some_and(|name| name == PREFERENCES_FILE)
            {
                MAX_PREFERENCES_BYTES
            } else {
                64 * 1024
            };
            if handle.metadata().map_err(|e| e.to_string())?.len() > maximum as u64 {
                return Err("Preferences file exceeds the supported size".into());
            }
            let mut raw = String::new();
            handle.read_to_string(&mut raw).map_err(|e| e.to_string())?;
            serde_json::from_str(&raw)
                .map(Some)
                .map_err(|e| format!("Invalid preferences: {e}"))
        }
    }
}

/// Where the first-run library folders go.
enum Defaults {
    /// Installed layout: `<root>/Mods/{Plugins,Snippets,Templates,Themes}`, `<root>/logs`.
    Standard,
    /// Portable layout: `<config>/{Plugins,Snippets,Templates,Themes,Logs}`.
    Portable,
    /// Legacy installer hint layout: `<content root>/{Plugins,Snippets,Templates,Themes,Logs}`.
    ContentRoot(String),
}

fn create_checked(path: &Path, locks: &mut Vec<fs::File>) -> Result<(), String> {
    if let Err(e) = fs::create_dir(path) {
        if e.kind() != std::io::ErrorKind::AlreadyExists {
            return Err(e.to_string());
        }
    }
    locks.push(open_checked(path, true)?);
    Ok(())
}

/// The five folders directly under `root`, created when missing.
fn flat_paths(root: &Path) -> Result<LibraryPaths, String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let mut locks = Vec::new();
    lock_ancestors(root, &mut locks)?;
    for name in portable::LIBRARY_FOLDERS {
        create_checked(&root.join(name), &mut locks)?;
    }
    Ok(LibraryPaths {
        plugins: text(&root.join("Plugins"))?,
        snippets: text(&root.join("Snippets"))?,
        templates: text(&root.join("Templates"))?,
        themes: text(&root.join("Themes"))?,
        logs: text(&root.join("Logs"))?,
    })
}

fn default_paths_for(config: &Path, defaults: &Defaults) -> Result<LibraryPaths, String> {
    match defaults {
        Defaults::Portable => flat_paths(config),
        Defaults::ContentRoot(root) => flat_paths(Path::new(root)),
        Defaults::Standard => {
            let mut locks = Vec::new();
            for relative in [
                "Mods",
                "Mods/Plugins",
                "Mods/Snippets",
                "Mods/Templates",
                "Mods/Themes",
                "logs",
            ] {
                create_checked(&config.join(relative), &mut locks)?;
            }
            Ok(LibraryPaths {
                plugins: text(&config.join("Mods/Plugins"))?,
                snippets: text(&config.join("Mods/Snippets"))?,
                templates: text(&config.join("Mods/Templates"))?,
                themes: text(&config.join("Mods/Themes"))?,
                logs: text(&config.join("logs"))?,
            })
        }
    }
}

/// The unchanged normal-mode defaults. Production code goes through `choose_defaults`.
#[cfg(test)]
fn default_paths(config: &Path) -> Result<LibraryPaths, String> {
    default_paths_for(config, &Defaults::Standard)
}

fn base_defaults(mode: Mode) -> Defaults {
    match mode {
        Mode::Portable => Defaults::Portable,
        Mode::Normal => Defaults::Standard,
    }
}

thread_local! {
    /// Set while the "hint unusable" report is written: logging reads the preferences again.
    static REPORTING_HINT: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}
/// Config roots already reported in this process, so a repeated read does not repeat the log entry.
static REPORTED_HINTS: std::sync::Mutex<Vec<PathBuf>> = std::sync::Mutex::new(Vec::new());

/// The hint's folders could not be created (for example an unplugged drive). Caller holds CHANGES.
/// The hint stays in place and nothing is persisted, so a later start with the drive back uses it.
fn report_unusable_hint(config: &Path, error: &str) {
    eprintln!("could not create the installer content folders: {error}");
    if REPORTING_HINT.with(|flag| flag.get()) {
        return;
    }
    {
        let Ok(mut reported) = REPORTED_HINTS.lock() else { return };
        if reported.iter().any(|seen| seen == config) {
            return;
        }
        reported.push(config.to_path_buf());
    }
    REPORTING_HINT.with(|flag| flag.set(true));
    // Logging resolves the log folder through the preferences, which lands back here: the flag stops that.
    let _ = super::error_logs::append_locked(
        config,
        "native.install-hint",
        &format!(
            "Could not create the content folders chosen by the installer ({error}). Using the default folders for now; {} is kept and will be tried again on the next start.",
            portable::HINT_FILE
        ),
    );
    REPORTING_HINT.with(|flag| flag.set(false));
}

/// A valid installer hint wins for a first run; an invalid one is ignored and reported.
fn choose_defaults(config: &Path, mode: Mode) -> (Defaults, Option<String>) {
    let base = base_defaults(mode);
    match portable::read_hint(config) {
        Hint::Valid(root) => (Defaults::ContentRoot(root), None),
        Hint::Invalid(reason) => (base, Some(reason)),
        Hint::Absent => (base, None),
    }
}

pub(super) fn default_logs(config: &Path) -> Result<PathBuf, String> {
    let mut locks = Vec::new();
    lock_ancestors(config, &mut locks)?;
    let path = config.join(if portable::active() == Mode::Portable { "Logs" } else { "logs" });
    if let Err(error) = fs::create_dir(&path) {
        if error.kind() != std::io::ErrorKind::AlreadyExists {
            return Err(error.to_string());
        }
    }
    open_checked(&path, true)?;
    Ok(path)
}

fn backfill_logs(raw_paths: &mut serde_json::Value, config: &Path) -> Result<bool, String> {
    if let Some(paths) = raw_paths.as_object_mut() {
        if !paths.contains_key("logs") {
            paths.insert(
                "logs".into(),
                serde_json::Value::String(text(&default_logs(config)?)?),
            );
            return Ok(true);
        }
    }
    Ok(false)
}

// Caller holds CHANGES, including for appends and path migrations.
pub(super) fn logs_directory_locked(config: &Path) -> Result<PathBuf, String> {
    Ok(PathBuf::from(read_preferences(config)?.paths.logs))
}

// Callers hold CHANGES; internal helpers never acquire it recursively.
fn read_preferences(config: &Path) -> Result<Preferences, String> {
    read_preferences_as(config, portable::active())
}

fn read_preferences_as(config: &Path, mode: Mode) -> Result<Preferences, String> {
    let mut preferences = read_preferences_base(config, mode)?;
    if mode == Mode::Normal {
        if let Some((root, identity)) = portable::read_install_request(config)? {
            if preferences.extra.get("installerRequest").and_then(serde_json::Value::as_str) != Some(&identity) {
                // Explicit selection replaces paths only: no file moves and no settings reset.
                preferences.paths = default_paths_for(Path::new(&root), &Defaults::Standard)?;
                preferences.extra.insert(CONTENT_ROOT.into(), root.into());
                preferences.extra.insert("installerRequest".into(), identity.into());
                publish_preferences(config, &preferences)?;
            }
        }
    }
    Ok(preferences)
}

fn read_preferences_base(config: &Path, mode: Mode) -> Result<Preferences, String> {
    let mut locks = Vec::new();
    lock_ancestors(config, &mut locks)?;
    if let Some(mut raw) = read_json(&config.join(PREFERENCES_FILE))? {
        let migrated = match raw.get_mut("paths") {
            Some(paths) => backfill_logs(paths, config)?,
            None => false,
        };
        let preferences: Preferences =
            serde_json::from_value(raw).map_err(|e| format!("Invalid preferences: {e}"))?;
        preferences.settings.validate()?;
        if migrated {
            publish_preferences(config, &preferences)?;
        }
        return Ok(preferences);
    }
    let mut applied_hint = None;
    let mut hint_problem = None;
    let mut hint_unusable = None;
    let paths = match read_json(&config.join("library-paths.json"))? {
        Some(mut raw) => {
            backfill_logs(&mut raw, config)?;
            serde_json::from_value(raw).map_err(|e| format!("Invalid legacy paths: {e}"))?
        }
        None => {
            // First run: nothing is saved yet, so the mode and an installer hint pick the defaults.
            let (defaults, problem) = choose_defaults(config, mode);
            hint_problem = problem;
            match default_paths_for(config, &defaults) {
                Ok(paths) => {
                    if let Defaults::ContentRoot(root) = &defaults {
                        applied_hint = Some(root.clone());
                    }
                    paths
                }
                // The chosen folders cannot be created now: use the normal defaults for this run only.
                Err(error) if matches!(defaults, Defaults::ContentRoot(_)) => {
                    hint_unusable = Some(error);
                    default_paths_for(config, &base_defaults(mode))?
                }
                Err(error) => return Err(error),
            }
        }
    };
    let settings =
        match read_json(&config.join("state.json"))?.and_then(|raw| raw.get("settings").cloned()) {
            Some(raw) => {
                serde_json::from_value(raw).map_err(|e| format!("Invalid legacy settings: {e}"))?
            }
            None => UserSettings::default(),
        };
    let mut extra = serde_json::Map::new();
    if mode == Mode::Portable {
        // Remembered so the saved paths can follow the folder when it is moved.
        extra.insert(PORTABLE_ROOT.into(), text(config)?.into());
    }
    if let Some(root) = &applied_hint {
        // Remembered so the content folders chosen by the installer keep counting as defaults.
        extra.insert(CONTENT_ROOT.into(), root.clone().into());
    }
    let preferences = Preferences {
        paths,
        settings,
        extra,
    };
    preferences.settings.validate()?;
    if let Some(error) = hint_unusable {
        // Not persisted and the hint is not consumed: the next read or start tries the hint again.
        report_unusable_hint(config, &error);
        return Ok(preferences);
    }
    publish_preferences(config, &preferences)?;
    // Read the authoritative file back before reporting a successful migration.
    let saved = read_preferences_base(config, mode)?;
    // Only now that the paths are persisted is the hint consumed; a failure above leaves it for the next start.
    if applied_hint.is_some() {
        if let Err(error) = portable::mark_hint_applied(config) {
            eprintln!("could not mark the installer hint as applied: {error}");
        }
    }
    if let Some(problem) = hint_problem {
        let _ = super::error_logs::append_locked(
            config,
            "native.install-hint",
            &format!("Ignored {}: {problem}", portable::HINT_FILE),
        );
    }
    Ok(saved)
}

fn read_paths(config: &Path) -> Result<LibraryPaths, String> {
    let paths = read_preferences(config)?.paths;
    let mut locks = Vec::new();
    for path in paths.all() {
        lock_ancestors(Path::new(path), &mut locks)?;
    }
    Ok(paths)
}

fn save_settings_in(config: &Path, mut settings: UserSettings) -> Result<(), String> {
    settings.validate()?;
    let mut preferences = read_preferences(config)?;
    if settings.ruler_guides.is_none() {
        settings.ruler_guides = preferences.settings.ruler_guides.clone();
    }
    if settings.zoom.is_none() {
        settings.zoom = preferences.settings.zoom;
    }
    if settings.auto_save_seconds.is_none() {
        settings.auto_save_seconds = preferences.settings.auto_save_seconds;
    }
    if settings.auto_commit_enabled.is_none() {
        settings.auto_commit_enabled = preferences.settings.auto_commit_enabled;
    }
    if settings.auto_commit_minutes.is_none() {
        settings.auto_commit_minutes = preferences.settings.auto_commit_minutes;
    }
    if settings.auto_commit_message.is_none() {
        settings.auto_commit_message = preferences.settings.auto_commit_message.clone();
    }
    preferences.settings = settings;
    publish_preferences(config, &preferences)
}

fn publish(config: &Path, paths: &LibraryPaths) -> Result<(), String> {
    let mut preferences = read_preferences(config)?;
    preferences.paths = paths.clone();
    publish_preferences(config, &preferences)
}

fn publish_preferences(config: &Path, preferences: &Preferences) -> Result<(), String> {
    let mut locks = Vec::new();
    lock_ancestors(config, &mut locks)?;
    let raw = serde_json::to_vec_pretty(preferences).map_err(|e| e.to_string())?;
    if raw.len() > MAX_PREFERENCES_BYTES {
        return Err("Preferences file exceeds the supported size".into());
    }
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
    copy_entries(entries, &destination, &mut locks, |_, _| Ok(None))?;
    grant(&destination)?;
    *paths.get_mut(kind) = text(&destination)?;
    publish(config, &paths)?;
    Ok(paths)
}

pub fn restore_scopes(app: &AppHandle) -> Result<LibraryPaths, String> {
    let _guard = CHANGES.lock().map_err(|e| e.to_string())?;
    restore_scopes_locked(app)
}

// Caller holds CHANGES, so the paths it gets stay current for as long as it keeps the lock.
pub(super) fn restore_scopes_locked(app: &AppHandle) -> Result<LibraryPaths, String> {
    let config = crate::config_root::path(&app)?;
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

/// Portable mode: when the folder was moved, saved paths that lived under the old `Data` root follow it.
/// Paths outside the old root are custom choices and stay as they are.
fn rebase_portable_in(config: &Path) -> Result<bool, String> {
    if read_json(&config.join(PREFERENCES_FILE))?.is_none() {
        return Ok(false);
    }
    let mut preferences = read_preferences(config)?;
    let current = text(config)?;
    let recorded = preferences
        .extra
        .get(PORTABLE_ROOT)
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    if recorded.as_deref() == Some(current.as_str()) {
        return Ok(false);
    }
    if let Some(old) = &recorded {
        for kind in [
            LibraryKind::Plugins,
            LibraryKind::Snippets,
            LibraryKind::Templates,
            LibraryKind::Themes,
            LibraryKind::Logs,
        ] {
            let path = preferences.paths.get_mut(kind);
            if let Some(rebased) = crate::config_root::rebased_path(path, Path::new(old), config) {
                *path = rebased;
            }
        }
    }
    preferences
        .extra
        .insert(PORTABLE_ROOT.into(), serde_json::Value::String(current));
    publish_preferences(config, &preferences)?;
    Ok(true)
}

/// Startup step for portable runs, before any scope is restored from the saved paths.
pub fn rebase_portable(app: &AppHandle) -> Result<bool, String> {
    if crate::config_root::mode(app) != Mode::Portable {
        return Ok(false);
    }
    let _guard = CHANGES.lock().map_err(|e| e.to_string())?;
    rebase_portable_in(&crate::config_root::path(app)?)
}

/// Which of the three seeded libraries still sit in the folders the app picked itself for this
/// layout (portable `Data` folders or the installer's content root). The standard `Mods` layout is
/// not reported here: the renderer already recognizes it.
#[derive(Clone, Copy, Default, Serialize, PartialEq, Debug)]
pub struct Managed {
    plugins: bool,
    snippets: bool,
    templates: bool,
}

#[derive(Serialize)]
pub struct LoadedPaths {
    #[serde(flatten)]
    paths: LibraryPaths,
    managed: Managed,
}

fn same_path(left: &str, right: &str) -> bool {
    crate::config_root::is_inside(left, Path::new(right))
        && crate::config_root::is_inside(right, Path::new(left))
}

fn managed_in(config: &Path, preferences: &Preferences, mode: Mode) -> Managed {
    let root = match preferences
        .extra
        .get(CONTENT_ROOT)
        .and_then(serde_json::Value::as_str)
    {
        Some(root) => root.to_string(),
        None if mode == Mode::Portable => text(config).unwrap_or_default(),
        None => return Managed::default(),
    };
    let is_default = |path: &str, name: &str| {
        same_path(path, &format!("{}/{name}", root.trim_end_matches('/')))
            || (mode == Mode::Normal && same_path(path, &format!("{}/Mods/{name}", root.trim_end_matches('/'))))
    };
    Managed {
        plugins: is_default(&preferences.paths.plugins, "Plugins"),
        snippets: is_default(&preferences.paths.snippets, "Snippets"),
        templates: is_default(&preferences.paths.templates, "Templates"),
    }
}

#[tauri::command]
pub async fn load_settings(app: AppHandle) -> Result<UserSettings, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = CHANGES.lock().map_err(|e| e.to_string())?;
        let config = crate::config_root::path(&app)?;
        Ok(read_preferences(&config)?.settings)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: UserSettings) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = CHANGES.lock().map_err(|e| e.to_string())?;
        let config = crate::config_root::path(&app)?;
        save_settings_in(&config, settings)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn load_library_paths(app: AppHandle) -> Result<LoadedPaths, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = CHANGES.lock().map_err(|e| e.to_string())?;
        let paths = restore_scopes_locked(&app)?;
        let config = crate::config_root::path(&app)?;
        let managed = managed_in(&config, &read_preferences(&config)?, crate::config_root::mode(&app));
        Ok(LoadedPaths { paths, managed })
    })
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
        let config = crate::config_root::path(&app)?;
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

fn delete_user_theme_in(config: &Path, id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 64
        || !id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
    {
        return Err("Invalid theme ID".into());
    }
    let paths = read_paths(config)?;
    let themes_dir = fs::canonicalize(&paths.themes).map_err(|e| e.to_string())?;
    let mut target: Option<PathBuf> = None;
    for entry in fs::read_dir(&themes_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(stem) = name
            .strip_suffix(".css")
            .or_else(|| name.strip_suffix(".CSS"))
        {
            if stem == id {
                let meta = fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
                if !meta.is_file() || meta.file_type().is_symlink() {
                    return Err(
                        "The theme must be a regular, non-linked file. Reload and try again."
                            .into(),
                    );
                }
                target = Some(entry.path());
                break;
            }
        }
    }
    let file_path =
        target.ok_or("The theme file was already removed. Reload themes and try again.")?;
    let resolved = fs::canonicalize(&file_path).map_err(|e| e.to_string())?;
    if resolved.parent() != Some(themes_dir.as_path()) {
        return Err("Theme file escapes the configured themes folder".into());
    }
    fs::remove_file(&resolved).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_user_theme(app: AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = CHANGES.lock().map_err(|e| e.to_string())?;
        let config = crate::config_root::path(&app)?;
        delete_user_theme_in(&config, &id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod preferences_tests {
    use super::*;
    #[test]
    fn preferences_error_logs_switch_copies_and_routes_appends_without_restart() {
        let config = scratch("logs-switch");
        super::super::error_logs::append_in(&config, "test", "before-switch").unwrap();
        let old_path = config.join("logs/errors-0001.txt");
        let original = fs::read(&old_path).unwrap();
        let destination = config.join("new-logs");
        fs::create_dir(&destination).unwrap();
        {
            let _guard = CHANGES.lock().unwrap();
            change_in(&config, LibraryKind::Logs, &destination, |_| Ok(())).unwrap();
        }
        super::super::error_logs::append_in(&config, "test", "after-switch").unwrap();
        assert_eq!(fs::read(old_path).unwrap(), original);
        let copied = fs::read_to_string(destination.join("errors-0001.txt")).unwrap();
        assert!(copied.contains("before-switch"));
        assert!(copied.contains("after-switch"));
        let collision = config.join("collision");
        fs::create_dir(&collision).unwrap();
        fs::write(collision.join("errors-0001.txt"), "user log").unwrap();
        let before = fs::read(config.join(PREFERENCES_FILE)).unwrap();
        {
            let _guard = CHANGES.lock().unwrap();
            assert!(change_in(&config, LibraryKind::Logs, &collision, |_| Ok(())).is_err());
        }
        assert_eq!(fs::read(config.join(PREFERENCES_FILE)).unwrap(), before);
        assert_eq!(
            fs::read_to_string(collision.join("errors-0001.txt")).unwrap(),
            "user log"
        );
        super::super::error_logs::append_in(&config, "test", "after-rejection").unwrap();
        assert!(fs::read_to_string(destination.join("errors-0001.txt"))
            .unwrap()
            .contains("after-rejection"));
    }
    #[test]
    fn preferences_error_logs_concurrent_migration_retains_every_append() {
        let config = scratch("logs-concurrent");
        super::super::error_logs::append_in(&config, "test", "initial").unwrap();
        let destination = config.join("new-logs");
        fs::create_dir(&destination).unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
        let append = {
            let barrier = barrier.clone();
            let config = config.clone();
            std::thread::spawn(move || {
                barrier.wait();
                for index in 0..20 {
                    super::super::error_logs::append_in(
                        &config,
                        "test",
                        &format!("entry-{index:02}"),
                    )
                    .unwrap();
                }
            })
        };
        let migrate = {
            let barrier = barrier.clone();
            let config = config.clone();
            let destination = destination.clone();
            std::thread::spawn(move || {
                barrier.wait();
                let _guard = CHANGES.lock().unwrap();
                change_in(&config, LibraryKind::Logs, &destination, |_| Ok(())).unwrap();
            })
        };
        barrier.wait();
        append.join().unwrap();
        migrate.join().unwrap();
        let contents = fs::read_to_string(destination.join("errors-0001.txt")).unwrap();
        for index in 0..20 {
            assert_eq!(contents.matches(&format!("entry-{index:02}")).count(), 1);
        }
    }
    #[test]
    fn preferences_backfill_logs_preserves_existing_paths_settings_and_extra() {
        let config = scratch("backfill-logs");
        let paths = default_paths(&config).unwrap();
        let mut old = serde_json::json!({ "paths": paths, "settings": { "theme": "modern", "rulerGuides": [] }, "custom": "keep" });
        old["paths"].as_object_mut().unwrap().remove("logs");
        fs::write(
            config.join(PREFERENCES_FILE),
            serde_json::to_vec(&old).unwrap(),
        )
        .unwrap();
        let current = serde_json::to_value(read_preferences(&config).unwrap()).unwrap();
        assert_eq!(
            current["paths"]["logs"],
            text(&config.join("logs")).unwrap()
        );
        for name in ["plugins", "snippets", "templates", "themes"] {
            assert_eq!(current["paths"][name], old["paths"][name]);
        }
        assert_eq!(current["settings"], old["settings"]);
        assert_eq!(current["custom"], "keep");
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(
                &fs::read(config.join(PREFERENCES_FILE)).unwrap()
            )
            .unwrap(),
            current
        );
    }
    #[test]
    fn preferences_legacy_without_logs_preserves_zoom_and_guides() {
        let config = scratch("legacy-logs");
        let mut old = serde_json::to_value(default_paths(&config).unwrap()).unwrap();
        old.as_object_mut().unwrap().remove("logs");
        let legacy_bytes = serde_json::to_vec(&old).unwrap();
        fs::write(config.join("library-paths.json"), &legacy_bytes).unwrap();
        let legacy_settings = serde_json::json!({ "zoom": 1.5, "theme": "modern", "rulerGuides": [{ "id": "g", "axis": "row", "positionMm": 23.5 }] });
        fs::write(
            config.join("state.json"),
            serde_json::to_vec(&serde_json::json!({ "settings": legacy_settings })).unwrap(),
        )
        .unwrap();
        let saved = serde_json::to_value(read_preferences(&config).unwrap()).unwrap();
        assert_eq!(saved["settings"], legacy_settings);
        assert_eq!(saved["paths"]["logs"], text(&config.join("logs")).unwrap());
        assert_eq!(
            fs::read(config.join("library-paths.json")).unwrap(),
            legacy_bytes
        );
    }
    #[test]
    fn preferences_autocommit_roundtrip_preservation_and_bounds() {
        let config = scratch("autocommit");
        let legacy = read_preferences(&config).unwrap().settings;
        assert!(legacy.auto_commit_enabled.is_none());
        assert!(legacy.auto_commit_minutes.is_none());
        assert!(legacy.auto_commit_message.is_none());
        let values = serde_json::json!({"autoCommitEnabled": false, "autoCommitMinutes": 45, "autoCommitMessage": "Saved writing"});
        save_settings_in(&config, serde_json::from_value(values.clone()).unwrap()).unwrap();
        save_settings_in(&config, UserSettings { theme: Some("modern".into()), ..Default::default() }).unwrap();
        let saved = serde_json::to_value(read_preferences(&config).unwrap().settings).unwrap();
        for key in ["autoCommitEnabled", "autoCommitMinutes", "autoCommitMessage"] {
            assert_eq!(saved[key], values[key]);
        }
        let before = fs::read(config.join(PREFERENCES_FILE)).unwrap();
        for invalid in [
            serde_json::json!({"autoCommitMinutes": 0}),
            serde_json::json!({"autoCommitMinutes": 1441}),
            serde_json::json!({"autoCommitMessage": "   "}),
            serde_json::json!({"autoCommitMessage": "\0"}),
            serde_json::json!({"autoCommitMessage": "é".repeat(2049)}),
        ] {
            assert!(save_settings_in(&config, serde_json::from_value(invalid).unwrap()).is_err());
            assert_eq!(fs::read(config.join(PREFERENCES_FILE)).unwrap(), before);
        }
        for invalid in [serde_json::json!({"autoCommitMinutes": -1}), serde_json::json!({"autoCommitMinutes": 1.5}), serde_json::json!({"autoCommitEnabled": "false"})] {
            assert!(serde_json::from_value::<UserSettings>(invalid).is_err());
        }
        for minutes in [1, 20, 1440] {
            save_settings_in(&config, serde_json::from_value(serde_json::json!({"autoCommitEnabled": true, "autoCommitMinutes": minutes, "autoCommitMessage": "é".repeat(2048)})).unwrap()).unwrap();
            let saved = read_preferences(&config).unwrap().settings;
            assert_eq!(saved.auto_commit_enabled, Some(true));
            assert_eq!(saved.auto_commit_minutes, Some(minutes));
        }
    }

    #[test]
    fn preferences_autosave_roundtrip_preservation_and_bounds() {
        let config = scratch("autosave");
        assert!(read_preferences(&config)
            .unwrap()
            .settings
            .auto_save_seconds
            .is_none());
        let settings: UserSettings =
            serde_json::from_value(serde_json::json!({"autoSaveSeconds": 300})).unwrap();
        save_settings_in(&config, settings).unwrap();
        save_settings_in(
            &config,
            UserSettings {
                theme: Some("modern".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(
            read_preferences(&config)
                .unwrap()
                .settings
                .auto_save_seconds,
            Some(300)
        );
        let before = fs::read(config.join(PREFERENCES_FILE)).unwrap();
        for value in [0, 86401] {
            let invalid =
                serde_json::from_value(serde_json::json!({"autoSaveSeconds": value})).unwrap();
            assert!(save_settings_in(&config, invalid).is_err());
            assert_eq!(fs::read(config.join(PREFERENCES_FILE)).unwrap(), before);
        }
        for value in [1, 90, 86400] {
            save_settings_in(
                &config,
                serde_json::from_value(serde_json::json!({"autoSaveSeconds": value})).unwrap(),
            )
            .unwrap();
            assert_eq!(
                read_preferences(&config)
                    .unwrap()
                    .settings
                    .auto_save_seconds,
                Some(value)
            );
        }
        for value in [serde_json::json!(-1), serde_json::json!(1.5)] {
            assert!(serde_json::from_value::<UserSettings>(
                serde_json::json!({"autoSaveSeconds": value})
            )
            .is_err());
        }
    }

    #[test]
    fn preferences_zoom_roundtrip_preservation_and_bounds() {
        let config = scratch("zoom");
        let settings: UserSettings =
            serde_json::from_value(serde_json::json!({ "zoom": 1.75, "rulerGuides": [] })).unwrap();
        save_settings_in(&config, settings).unwrap();
        save_settings_in(
            &config,
            UserSettings {
                theme: Some("modern".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let saved = serde_json::to_value(read_preferences(&config).unwrap()).unwrap();
        assert_eq!(saved["settings"]["zoom"], 1.75);
        assert_eq!(saved["settings"]["rulerGuides"], serde_json::json!([]));
        let before = fs::read(config.join(PREFERENCES_FILE)).unwrap();
        for value in [0.0, 0.24, 3.01, -1.0] {
            let invalid = serde_json::from_value(serde_json::json!({ "zoom": value })).unwrap();
            assert!(save_settings_in(&config, invalid).is_err());
            assert_eq!(fs::read(config.join(PREFERENCES_FILE)).unwrap(), before);
        }
        for value in [0.25, 3.0] {
            save_settings_in(
                &config,
                serde_json::from_value(serde_json::json!({ "zoom": value })).unwrap(),
            )
            .unwrap();
        }
    }
    #[test]
    fn preferences_visual_guides_roundtrip_and_appearance_updates_preserve_them() {
        let config = scratch("guides");
        let settings: UserSettings = serde_json::from_value(serde_json::json!({
            "theme": "modern", "rulerGuides": [
                { "id": "row-1", "axis": "row", "positionMm": 42.5 },
                { "id": "column-1", "axis": "column", "positionMm": 80 }
            ]
        }))
        .unwrap();
        save_settings_in(&config, settings.clone()).unwrap();
        assert_eq!(read_preferences(&config).unwrap().settings, settings);
        save_settings_in(
            &config,
            UserSettings {
                theme: Some("sci-fi".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let saved = serde_json::to_value(read_preferences(&config).unwrap().settings).unwrap();
        assert_eq!(saved["rulerGuides"].as_array().unwrap().len(), 2);
        assert_eq!(saved["theme"], "sci-fi");
    }
    #[test]
    fn preferences_many_guides_and_rejected_changes_preserve_saved_settings() {
        let config = scratch("many-guides");
        let guides = (0..1000)
            .map(|index| RulerGuide {
                id: format!("guide-{index}"),
                axis: GuideAxis::Row,
                position_mm: index as f64 / 10.0,
            })
            .collect();
        let settings = UserSettings {
            ruler_guides: Some(guides),
            ..Default::default()
        };
        save_settings_in(&config, settings.clone()).unwrap();
        assert_eq!(read_preferences(&config).unwrap().settings, settings);
        let original = fs::read(config.join(PREFERENCES_FILE)).unwrap();
        let invalid = UserSettings {
            ruler_guides: Some(vec![RulerGuide {
                id: "bad".into(),
                axis: GuideAxis::Column,
                position_mm: -1.0,
            }]),
            ..Default::default()
        };
        assert!(save_settings_in(&config, invalid).is_err());
        let oversized = UserSettings {
            theme: Some("a".repeat(MAX_PREFERENCES_BYTES)),
            ..Default::default()
        };
        assert!(save_settings_in(&config, oversized).is_err());
        assert_eq!(fs::read(config.join(PREFERENCES_FILE)).unwrap(), original);
        save_settings_in(
            &config,
            UserSettings {
                ruler_guides: Some(vec![]),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(
            read_preferences(&config).unwrap().settings.ruler_guides,
            Some(vec![])
        );
    }
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
            ..Default::default()
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
            LibraryKind::Logs,
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
                        ..Default::default()
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

    #[test]
    fn saved_panels_round_trip_and_unknown_panels_are_rejected() {
        let settings: UserSettings = serde_json::from_str(r#"{"panels":{"files":false,"documentIndex":true}}"#).unwrap();
        assert_eq!(settings.panels.as_ref().and_then(|p| p.files), Some(false));
        assert_eq!(serde_json::to_string(&settings).unwrap(), r#"{"panels":{"files":false,"documentIndex":true}}"#);
        assert!(serde_json::from_str::<UserSettings>(r#"{"panels":{"bogus":true}}"#).is_err());
    }

    #[test]
    fn deletes_only_regular_css_files_inside_configured_themes_folder() {
        let config = scratch("delete-theme");
        let paths = read_paths(&config).unwrap();
        let themes = Path::new(&paths.themes);
        fs::write(themes.join("theme-test.css"), "/* @name: ThemeTest */").unwrap();
        delete_user_theme_in(&config, "theme-test").unwrap();
        assert!(!themes.join("theme-test.css").exists());
        assert!(delete_user_theme_in(&config, "theme-test").is_err());
        assert!(delete_user_theme_in(&config, "../outside").is_err());
    }

    fn paths_file(config: &Path) -> serde_json::Value {
        serde_json::from_slice(&fs::read(config.join(PREFERENCES_FILE)).unwrap()).unwrap()
    }
    fn copy_tree(from: &Path, to: &Path) {
        fs::create_dir_all(to).unwrap();
        for entry in fs::read_dir(from).unwrap() {
            let entry = entry.unwrap();
            let target = to.join(entry.file_name());
            if entry.file_type().unwrap().is_dir() {
                copy_tree(&entry.path(), &target);
            } else {
                fs::copy(entry.path(), target).unwrap();
            }
        }
    }
    fn write_hint(config: &Path, content: &Path) {
        fs::write(
            config.join(portable::HINT_FILE),
            format!("{}\r\n", content.to_str().unwrap()),
        )
        .unwrap();
    }

    #[test]
    fn installer_request_updates_existing_paths_once_without_moving_content() {
        let config = scratch("installer-request");
        let mut original = read_preferences_as(&config, Mode::Normal).unwrap();
        original.extra.insert("keep".into(), "value".into());
        publish_preferences(&config, &original).unwrap();
        fs::write(Path::new(&original.paths.plugins).join("keep.txt"), "original").unwrap();
        let content = scratch("installer-content");
        fs::write(config.join("install-content-root-v2.txt"), text(&content).unwrap()).unwrap();
        let saved = read_preferences_as(&config, Mode::Normal).unwrap();
        for (actual, relative) in [
            (&saved.paths.plugins, "Mods/Plugins"), (&saved.paths.snippets, "Mods/Snippets"),
            (&saved.paths.templates, "Mods/Templates"), (&saved.paths.themes, "Mods/Themes"), (&saved.paths.logs, "logs"),
        ] {
            assert_eq!(*actual, text(&content.join(relative)).unwrap());
            assert!(content.join(relative).is_dir());
        }
        assert_eq!(saved.extra["keep"], "value");
        assert_eq!(serde_json::to_value(&saved.settings).unwrap(), serde_json::to_value(&original.settings).unwrap());
        assert_eq!(fs::read_to_string(Path::new(&original.paths.plugins).join("keep.txt")).unwrap(), "original");
        assert_eq!(managed_in(&config, &saved, Mode::Normal), Managed { plugins: true, snippets: true, templates: true });
        let mut custom = saved;
        custom.paths.plugins = original.paths.plugins;
        publish_preferences(&config, &custom).unwrap();
        assert_eq!(read_preferences_as(&config, Mode::Normal).unwrap().paths, custom.paths);
        // An explicit new selection may choose the configuration root itself.
        fs::write(config.join("install-content-root-v2.txt"), text(&config).unwrap()).unwrap();
        let selected_config = read_preferences_as(&config, Mode::Normal).unwrap();
        assert_eq!(selected_config.paths, default_paths(&config).unwrap());
        // A rejected request never changes the previously published preferences.
        let before = fs::read(config.join(PREFERENCES_FILE)).unwrap();
        fs::write(config.join("install-content-root-v2.txt"), "relative/path").unwrap();
        assert!(read_preferences_as(&config, Mode::Normal).is_err());
        assert_eq!(fs::read(config.join(PREFERENCES_FILE)).unwrap(), before);
        let portable_config = scratch("request-portable");
        fs::write(portable_config.join("install-content-root-v2.txt"), text(&content).unwrap()).unwrap();
        let portable = read_preferences_as(&portable_config, Mode::Portable).unwrap();
        assert_eq!(portable.paths.plugins, text(&portable_config.join("Plugins")).unwrap());
    }

    #[test]
    fn normal_mode_without_a_hint_keeps_todays_defaults_and_adds_no_markers() {
        let config = scratch("normal-defaults");
        let loaded = read_preferences_as(&config, Mode::Normal).unwrap();
        let saved = loaded.paths.clone();
        for (actual, relative) in [
            (&saved.plugins, "Mods/Plugins"),
            (&saved.snippets, "Mods/Snippets"),
            (&saved.templates, "Mods/Templates"),
            (&saved.themes, "Mods/Themes"),
            (&saved.logs, "logs"),
        ] {
            assert_eq!(*actual, text(&config.join(relative)).unwrap());
            assert!(config.join(relative).is_dir());
        }
        assert_eq!(saved, default_paths(&config).unwrap());
        let file = paths_file(&config);
        assert!(file.get(PORTABLE_ROOT).is_none() && file.get(CONTENT_ROOT).is_none());
        assert!(!config.join("Plugins").exists());
        assert_eq!(managed_in(&config, &loaded, Mode::Normal), Managed::default());
    }

    #[test]
    fn normal_mode_migration_from_legacy_files_ignores_a_stray_hint() {
        let config = scratch("normal-legacy");
        let legacy = default_paths(&config).unwrap();
        fs::write(config.join("library-paths.json"), serde_json::to_vec(&legacy).unwrap()).unwrap();
        let content = scratch("normal-legacy-content");
        write_hint(&config, &content.join("Grimoire"));
        let migrated = read_preferences_as(&config, Mode::Normal).unwrap().paths;
        assert_eq!(migrated, legacy);
        assert!(config.join(portable::HINT_FILE).is_file());
        assert!(!content.join("Grimoire").exists());
    }

    #[test]
    fn portable_first_run_uses_flat_folders_inside_data_and_records_its_root() {
        let config = scratch("portable-defaults");
        let saved = read_preferences_as(&config, Mode::Portable).unwrap();
        for (actual, name) in [
            (&saved.paths.plugins, "Plugins"),
            (&saved.paths.snippets, "Snippets"),
            (&saved.paths.templates, "Templates"),
            (&saved.paths.themes, "Themes"),
            (&saved.paths.logs, "Logs"),
        ] {
            assert_eq!(*actual, text(&config.join(name)).unwrap());
            assert!(config.join(name).is_dir());
        }
        assert!(!config.join("Mods").exists());
        assert_eq!(paths_file(&config)[PORTABLE_ROOT], text(&config).unwrap());
        let managed = managed_in(&config, &saved, Mode::Portable);
        assert_eq!(managed, Managed { plugins: true, snippets: true, templates: true });
    }

    #[test]
    fn installer_hint_sets_the_defaults_once_and_is_renamed_after_persisting() {
        let config = scratch("hint-config");
        let content = scratch("hint-content").join("Grimoire Maker");
        write_hint(&config, &content);
        let saved = read_preferences_as(&config, Mode::Normal).unwrap();
        for name in portable::LIBRARY_FOLDERS {
            assert!(content.join(name).is_dir());
        }
        assert_eq!(saved.paths.plugins, text(&content.join("Plugins")).unwrap());
        assert_eq!(saved.paths.themes, text(&content.join("Themes")).unwrap());
        assert_eq!(saved.paths.logs, text(&content.join("Logs")).unwrap());
        assert!(!config.join(portable::HINT_FILE).exists());
        assert!(config.join(portable::HINT_APPLIED_FILE).is_file());
        assert!(!config.join("Mods").exists());
        let file = paths_file(&config);
        assert_eq!(file["paths"]["templates"], text(&content.join("Templates")).unwrap());
        assert_eq!(file[CONTENT_ROOT], text(&content).unwrap());
        assert!(file.get(PORTABLE_ROOT).is_none());
        let managed = managed_in(&config, &saved, Mode::Normal);
        assert_eq!(managed, Managed { plugins: true, snippets: true, templates: true });
        // A second start reads the saved paths and never consults the applied hint.
        assert_eq!(read_preferences_as(&config, Mode::Normal).unwrap().paths, saved.paths);
        let mut custom = saved.paths.clone();
        custom.snippets = text(&config.join("custom")).unwrap();
        let changed = Preferences { paths: custom, settings: UserSettings::default(), extra: saved.extra.clone() };
        assert_eq!(
            managed_in(&config, &changed, Mode::Normal),
            Managed { plugins: true, snippets: false, templates: true }
        );
    }

    #[test]
    fn saved_paths_always_win_over_a_hint() {
        let config = scratch("hint-saved");
        let first = read_preferences_as(&config, Mode::Normal).unwrap().paths;
        let content = scratch("hint-saved-content");
        write_hint(&config, &content.join("Late"));
        assert_eq!(read_preferences_as(&config, Mode::Normal).unwrap().paths, first);
        assert!(config.join(portable::HINT_FILE).is_file());
        assert!(!content.join("Late").exists());
    }

    #[test]
    fn a_hint_whose_folders_cannot_be_created_falls_back_to_defaults_and_keeps_the_hint() {
        let config = scratch("hint-failure");
        let content = scratch("hint-failure-content");
        fs::write(content.join("blocker"), "a file").unwrap();
        write_hint(&config, &content.join("blocker/Grimoire"));
        // Startup is not blocked: the normal defaults are used for this run only.
        let fallback = read_preferences_as(&config, Mode::Normal).unwrap();
        assert_eq!(fallback.paths, default_paths(&config).unwrap());
        assert!(fallback.extra.get(CONTENT_ROOT).is_none());
        assert!(config.join(portable::HINT_FILE).is_file());
        assert!(!config.join(portable::HINT_APPLIED_FILE).exists());
        assert!(!config.join(PREFERENCES_FILE).exists());
        // The failure is logged once, in the default log folder.
        let log = fs::read_to_string(config.join("logs/errors-0001.txt")).unwrap();
        assert!(log.contains("native.install-hint") && log.contains("tried again"), "{log}");
        read_preferences_as(&config, Mode::Normal).unwrap();
        let log = fs::read_to_string(config.join("logs/errors-0001.txt")).unwrap();
        assert_eq!(log.matches("native.install-hint").count(), 1, "{log}");
        // Once the problem is gone, the very same hint is applied.
        fs::remove_file(content.join("blocker")).unwrap();
        let saved = read_preferences_as(&config, Mode::Normal).unwrap();
        assert_eq!(saved.paths.logs, text(&content.join("blocker/Grimoire/Logs")).unwrap());
        assert!(config.join(portable::HINT_APPLIED_FILE).is_file());
    }

    #[test]
    fn an_invalid_hint_is_ignored_logged_and_left_in_place() {
        let config = scratch("hint-invalid");
        fs::write(config.join(portable::HINT_FILE), "relative\\folder").unwrap();
        let saved = read_preferences_as(&config, Mode::Normal).unwrap();
        assert_eq!(saved.paths, default_paths(&config).unwrap());
        assert!(config.join(portable::HINT_FILE).is_file());
        assert!(!config.join(portable::HINT_APPLIED_FILE).exists());
        assert!(paths_file(&config).get(CONTENT_ROOT).is_none());
        let log = fs::read_to_string(config.join("logs/errors-0001.txt")).unwrap();
        assert!(log.contains("native.install-hint") && log.contains(portable::HINT_FILE), "{log}");
    }

    #[test]
    fn a_hint_inside_the_config_root_is_not_used() {
        let config = scratch("hint-inside");
        write_hint(&config, &config.join("Content"));
        let saved = read_preferences_as(&config, Mode::Normal).unwrap();
        assert_eq!(saved.paths, default_paths(&config).unwrap());
        assert!(!config.join("Content").exists());
    }

    #[test]
    fn moving_the_portable_folder_rebases_only_paths_under_the_old_root() {
        let old = scratch("rebase-old");
        let external = scratch("rebase-external");
        let mut saved = read_preferences_as(&old, Mode::Portable).unwrap();
        saved.paths.themes = text(&external).unwrap();
        publish_preferences(&old, &saved).unwrap();
        fs::write(old.join("Snippets/note.md"), "kept").unwrap();
        assert!(!rebase_portable_in(&old).unwrap());
        let moved = scratch("rebase-new").join("Grimoire Portable/Data");
        copy_tree(&old, &moved);
        assert!(rebase_portable_in(&moved).unwrap());
        let now = read_preferences(&moved).unwrap();
        assert_eq!(now.paths.plugins, text(&moved.join("Plugins")).unwrap());
        assert_eq!(now.paths.snippets, text(&moved.join("Snippets")).unwrap());
        assert_eq!(now.paths.templates, text(&moved.join("Templates")).unwrap());
        assert_eq!(now.paths.logs, text(&moved.join("Logs")).unwrap());
        assert_eq!(now.paths.themes, text(&external).unwrap());
        assert_eq!(paths_file(&moved)[PORTABLE_ROOT], text(&moved).unwrap());
        assert_eq!(fs::read_to_string(Path::new(&now.paths.snippets).join("note.md")).unwrap(), "kept");
        // Idempotent, and the original copy is untouched.
        assert!(!rebase_portable_in(&moved).unwrap());
        assert_eq!(read_preferences(&old).unwrap().paths.plugins, text(&old.join("Plugins")).unwrap());
    }

    #[test]
    fn portable_rebase_records_the_root_for_settings_that_predate_it_and_skips_missing_settings() {
        let config = scratch("rebase-legacy");
        assert!(!rebase_portable_in(&config).unwrap());
        assert!(!config.join(PREFERENCES_FILE).exists());
        let saved = read_preferences_as(&config, Mode::Normal).unwrap();
        let before = saved.paths.clone();
        assert!(rebase_portable_in(&config).unwrap());
        assert_eq!(read_preferences(&config).unwrap().paths, before);
        assert_eq!(paths_file(&config)[PORTABLE_ROOT], text(&config).unwrap());
    }
}
