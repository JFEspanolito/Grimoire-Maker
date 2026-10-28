//! Managed storage for external plugins: versioned immutable directories plus a registry file.
//!
//! Layout under the managed root:
//!   registry.json                       -> which versions exist (replaced via temp file + rename)
//!   <id>/<version>-<fingerprint12>/     -> immutable once published, never edited in place
//!   .staging-*                          -> in-progress installs, removed by recovery
//!
//! `latest` is the most recently installed version; `current` is the approved version that may
//! run and is never moved by an install. An update therefore cannot inherit an earlier approval.
use crate::{plugin_install, plugin_package};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const REGISTRY: &str = "registry.json";
const REGISTRY_TMP: &str = "registry.json.tmp";
const LOCK_FILE: &str = ".lock";
pub(crate) const STAGING_PREFIX: &str = ".staging-";
const MAX_REGISTRY_BYTES: u64 = 4 * 1024 * 1024;
static INSTALL_LOCK: Mutex<()> = Mutex::new(());

fn default_sdk() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VersionRecord {
    pub dir: String,
    pub version: String,
    pub fingerprint: String,
    pub name: String,
    pub author: String,
    pub description: String,
    pub permissions: Vec<String>,
    /// Permissions the user approved for exactly this version (filled by the consent flow).
    #[serde(default)]
    pub granted: Vec<String>,
    /// SDK contract the package was built for; consent is bound to it.
    #[serde(default = "default_sdk")]
    pub sdk_version: u32,
    /// When the user approved exactly this version, or None while unapproved.
    #[serde(default)]
    pub consent_at: Option<u64>,
    pub installed_at: u64,
    /// `import` (installed from a ZIP) or `local` (synced from a package folder in Mods/Plugins).
    pub source: String,
    #[serde(default)]
    pub signature: Option<String>,
    /// For `local` versions: the folder name inside the Plugins folder that provides the package.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_folder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginRecord {
    pub latest: String,
    #[serde(default)]
    pub current: Option<String>,
    /// `installed` (approved or not, not running), `active`, `stopped` (terminated by the host)
    /// or `altered` (files differ from the recorded fingerprint).
    pub state: String,
    pub versions: Vec<VersionRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Registry {
    pub version: u32,
    /// Emergency switch: while set, no external plugin may be activated or read for execution.
    #[serde(default)]
    pub disabled_all: bool,
    pub plugins: BTreeMap<String, PluginRecord>,
}

impl Default for Registry {
    fn default() -> Self {
        Registry { version: 1, disabled_all: false, plugins: BTreeMap::new() }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub permissions: Vec<String>,
    pub fingerprint: String,
    pub already_installed: bool,
}

/// Serializes registry changes inside this process and, through an OS file lock, across several
/// running instances of the application.
pub(crate) struct Guard {
    _file: Option<File>,
    _process: std::sync::MutexGuard<'static, ()>,
}

fn lock() -> Result<Guard, String> {
    let process = INSTALL_LOCK.lock().map_err(|error| error.to_string())?;
    Ok(Guard { _file: None, _process: process })
}

/// Process lock, then the prepared root, then the cross-instance lock.
pub(crate) fn locked(root: &Path) -> Result<Guard, String> {
    let mut guard = lock()?;
    prepare_root(root)?;
    lock_root(&mut guard, root)?;
    Ok(guard)
}

/// Takes the cross-instance lock once the managed root exists.
fn lock_root(guard: &mut Guard, root: &Path) -> Result<(), String> {
    let file = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(root.join(LOCK_FILE))
        .map_err(|error| format!("Could not open the plugin lock: {error}"))?;
    file.lock().map_err(|error| format!("Could not lock the plugin registry: {error}"))?;
    guard._file = Some(file);
    Ok(())
}

/// Creates the managed root if needed and refuses a link or file in its place.
pub fn prepare_root(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let info = fs::symlink_metadata(root).map_err(|error| error.to_string())?;
    crate::safe_copy::reject_special(&info)?;
    if !info.is_dir() {
        return Err("The managed plugin folder is not a directory".into());
    }
    Ok(())
}

pub fn load_registry(root: &Path) -> Result<Registry, String> {
    let path = root.join(REGISTRY);
    match fs::symlink_metadata(&path) {
        Err(_) => return Ok(Registry::default()),
        Ok(info) => {
            crate::safe_copy::reject_special(&info)?;
            if !info.is_file() || info.len() > MAX_REGISTRY_BYTES {
                return Err("The plugin registry is not a regular file within its size limit".into());
            }
        }
    }
    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    // A damaged registry is reported and left untouched so nothing is overwritten blindly.
    let registry: Registry = serde_json::from_slice(&bytes)
        .map_err(|error| format!("The plugin registry is unreadable and was left unchanged: {error}"))?;
    if registry.version != 1 {
        return Err("The plugin registry has an unsupported version and was left unchanged".into());
    }
    Ok(registry)
}

/// Writes to a temp file and renames over the registry; a failure leaves the old file intact.
pub(crate) fn save_registry(root: &Path, registry: &Registry) -> Result<(), String> {
    let temp = root.join(REGISTRY_TMP);
    let bytes = serde_json::to_vec_pretty(registry).map_err(|error| error.to_string())?;
    let mut file = File::create(&temp).map_err(|error| format!("Could not write the plugin registry: {error}"))?;
    let written = file.write_all(&bytes).and_then(|_| file.sync_all());
    drop(file);
    if let Err(error) = written {
        let _ = fs::remove_file(&temp);
        return Err(format!("Could not write the plugin registry: {error}"));
    }
    fs::rename(&temp, root.join(REGISTRY)).map_err(|error| {
        let _ = fs::remove_file(&temp);
        format!("Could not publish the plugin registry: {error}")
    })
}

pub(crate) fn plain_dir(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|info| info.is_dir() && crate::safe_copy::reject_special(&info).is_ok())
}

/// Removes only in-progress leftovers: staging directories and the temp registry. Version
/// directories are never deleted here, even when the registry does not mention them: a lost or
/// restored registry must not destroy installed files (a matching reinstall reuses them).
pub(crate) fn recover_locked(root: &Path) -> Result<(), String> {
    let entries = fs::read_dir(root).map_err(|error| error.to_string())?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        if name.starts_with(STAGING_PREFIX) && plain_dir(&path) {
            let _ = fs::remove_dir_all(&path);
        } else if name == REGISTRY_TMP {
            let _ = fs::remove_file(&path);
        }
    }
    Ok(())
}

pub fn recover(root: &Path) -> Result<(), String> {
    let _guard = locked(root)?;
    recover_locked(root)
}

pub(crate) fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub(crate) fn nonce() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)
}

/// Installs the package at `zip` without altering any existing version on failure.
pub fn install(root: &Path, zip: &Path, limit: Duration) -> Result<InstallResult, String> {
    let result = install_locked(root, zip, limit);
    match &result {
        Ok(done) => audit(root, if done.already_installed { "already_installed" } else { "installed" }, &done.id,
            &format!("{} {}", done.version, &done.fingerprint[..12])),
        Err(error) => audit(root, "install_rejected", "-", error),
    }
    result
}

fn install_locked(root: &Path, zip: &Path, limit: Duration) -> Result<InstallResult, String> {
    let _guard = locked(root)?;
    let mut registry = load_registry(root)?;
    recover_locked(root)?;

    let staging = root.join(format!("{STAGING_PREFIX}{}-{}", std::process::id(), nonce()));
    let extracted = plugin_install::extract_package(zip, &staging, limit)?;
    let manifest = extracted.manifest;
    let dir = format!("{}-{}", manifest.version, &extracted.fingerprint[..12]);
    let summary = |already_installed| InstallResult {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        version: manifest.version.clone(),
        author: manifest.author.clone(),
        description: manifest.description.clone(),
        permissions: manifest.permissions.clone(),
        fingerprint: extracted.fingerprint.clone(),
        already_installed,
    };

    if registry.plugins.get(&manifest.id).is_some_and(|record| record.versions.iter().any(|v| v.dir == dir)) {
        let _ = fs::remove_dir_all(&staging);
        return Ok(summary(true));
    }

    let plugin_dir = root.join(&manifest.id);
    let created_plugin_dir = !plugin_dir.exists();
    let published = publish(&staging, &plugin_dir, &dir, &extracted.fingerprint);
    let reused = matches!(published, Ok(true));
    if let Err(error) = published {
        let _ = fs::remove_dir_all(&staging);
        if created_plugin_dir {
            let _ = fs::remove_dir(&plugin_dir);
        }
        return Err(error);
    }

    let record = registry.plugins.entry(manifest.id.clone()).or_insert_with(|| PluginRecord {
        latest: dir.clone(),
        current: None,
        state: "installed".into(),
        versions: Vec::new(),
    });
    record.latest = dir.clone();
    record.versions.push(VersionRecord {
        dir: dir.clone(),
        version: manifest.version.clone(),
        fingerprint: extracted.fingerprint.clone(),
        name: manifest.name.clone(),
        author: manifest.author.clone(),
        description: manifest.description.clone(),
        permissions: manifest.permissions.clone(),
        granted: Vec::new(),
        sdk_version: manifest.sdk_version,
        consent_at: None,
        installed_at: now(),
        source: IMPORT_SOURCE.into(),
        signature: None,
        local_folder: None,
    });
    if let Err(error) = save_registry(root, &registry) {
        // The registry still describes the previous state: withdraw the version we just published.
        if !reused {
            let _ = fs::remove_dir_all(plugin_dir.join(&dir));
        }
        if created_plugin_dir {
            let _ = fs::remove_dir(&plugin_dir);
        }
        return Err(error);
    }
    Ok(summary(false))
}

/// Moves the validated staging directory to its final immutable location, never overwriting.
pub(crate) fn publish(staging: &Path, plugin_dir: &Path, dir: &str, fingerprint: &str) -> Result<bool, String> {
    fs::create_dir_all(plugin_dir).map_err(|error| error.to_string())?;
    let info = fs::symlink_metadata(plugin_dir).map_err(|error| error.to_string())?;
    crate::safe_copy::reject_special(&info)?;
    if !info.is_dir() {
        return Err("The plugin folder is not a directory".into());
    }
    let destination = plugin_dir.join(dir);
    if destination.exists() {
        // The directory name embeds the fingerprint, so a verified match is the same package
        // (left behind by a lost registry or an interrupted removal) and is reused as is.
        if plugin_install::fingerprint_dir(&destination).as_deref() == Ok(fingerprint) {
            let _ = fs::remove_dir_all(staging);
            return Ok(true);
        }
        return Err("That plugin version already exists on disk with different contents".into());
    }
    fs::rename(staging, destination).map(|_| false).map_err(|error| format!("Could not publish the plugin: {error}"))
}

pub fn list(root: &Path) -> Result<Registry, String> {
    let _guard = locked(root)?;
    let mut registry = load_registry(root)?;
    recover_locked(root)?;
    let altered = verify_integrity(root, &mut registry);
    if !altered.is_empty() {
        save_registry(root, &registry)?;
        for id in altered {
            audit(root, "integrity_failed", &id, "installed files differ from the recorded fingerprint");
        }
    }
    Ok(registry)
}

/// Recomputes the fingerprint of the newest and the approved version of every plugin. A mismatch
/// (or unreadable files) marks the plugin `altered` and withdraws its approval, so changed bytes
/// can never run on an earlier consent. Returns the ids newly marked.
pub fn verify_integrity(root: &Path, registry: &mut Registry) -> Vec<String> {
    let mut newly = Vec::new();
    for (id, record) in registry.plugins.iter_mut() {
        let mut dirs = vec![record.latest.clone()];
        dirs.extend(record.current.clone().filter(|current| *current != record.latest));
        let mut tampered = false;
        for dir in dirs {
            let expected = record.versions.iter().find(|v| v.dir == dir).map(|v| v.fingerprint.as_str());
            let actual = plugin_install::fingerprint_dir(&root.join(id).join(&dir));
            if expected.is_none() || actual.as_deref().ok() != expected {
                tampered = true;
                if record.current.as_deref() == Some(dir.as_str()) {
                    record.current = None;
                }
            }
        }
        if tampered && record.state != "altered" {
            record.state = "altered".into();
            newly.push(id.clone());
        }
    }
    newly
}

/// Best-effort local audit trail (one JSON object per line, rotated at 1 MiB). It never fails
/// or blocks the operation it describes.
pub(crate) fn audit(root: &Path, event: &str, id: &str, detail: &str) {
    const LIMIT: u64 = 1024 * 1024;
    let path = root.join("audit.log");
    match fs::symlink_metadata(&path) {
        Ok(info) if !info.is_file() || crate::safe_copy::reject_special(&info).is_err() => return,
        Ok(info) if info.len() > LIMIT => {
            let _ = fs::rename(&path, root.join("audit.log.1"));
        }
        _ => {}
    }
    let detail: String = detail.chars().take(300).collect();
    let line = serde_json::json!({ "at": now(), "event": event, "id": id, "detail": detail });
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{line}");
    }
}

/// `source` of a version installed from a ZIP file.
pub(crate) const IMPORT_SOURCE: &str = "import";
/// `source` of a version synced from a package folder in Mods/Plugins.
pub(crate) const LOCAL_SOURCE: &str = "local";

/// Source of the newest version of the plugin.
pub(crate) fn latest_source(record: &PluginRecord) -> Option<&str> {
    record.versions.iter().find(|v| v.dir == record.latest).map(|v| v.source.as_str())
}

/// True when the approved version is a local package, which the emergency switch does not cover:
/// the user put that folder there and trusted plugins in the same folder already run.
fn exempt_from_switch(record: &PluginRecord) -> bool {
    record
        .current
        .as_ref()
        .and_then(|current| record.versions.iter().find(|v| &v.dir == current))
        .is_some_and(|v| v.source == LOCAL_SOURCE)
}

/// Renderer-callable removal: only imported plugins. Local packages are deleted by deleting
/// their folder, which the next sync notices.
pub fn remove(root: &Path, id: &str) -> Result<(), String> {
    // Reserved builtin.* ids pass only to be looked up: they exist in the registry solely when
    // the application itself installed them, so an import can never reach them this way.
    plugin_package::validate_id_for(id, true)?;
    let _guard = locked(root)?;
    let mut registry = load_registry(root)?;
    match registry.plugins.get(id) {
        None => return Err("That plugin is not installed".into()),
        Some(record) if latest_source(record) != Some(IMPORT_SOURCE) => {
            return Err("This plugin comes from a package folder. Delete the folder instead".into());
        }
        Some(_) => {}
    }
    remove_locked(root, &mut registry, id, "removed")
}

/// Updates the registry first, then deletes the plugin's own folder; a failed delete leaves an
/// unreferenced folder that a later install of identical bytes reuses. The caller holds the lock.
pub(crate) fn remove_locked(root: &Path, registry: &mut Registry, id: &str, event: &str) -> Result<(), String> {
    plugin_package::validate_id_for(id, true)?;
    let removed = registry.plugins.remove(id).ok_or("That plugin is not installed")?;
    if let Err(error) = save_registry(root, registry) {
        registry.plugins.insert(id.to_string(), removed);
        return Err(error);
    }
    audit(root, event, id, "");
    let folder: PathBuf = root.join(id);
    if plain_dir(&folder) {
        fs::remove_dir_all(&folder).map_err(|error| format!("The plugin was unregistered but its files could not be deleted: {error}"))?;
    }
    Ok(())
}

/// Everything the renderer needs to run one approved, active plugin inside the isolated runtime.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryPayload {
    pub id: String,
    pub version: String,
    pub fingerprint: String,
    pub sdk_version: u32,
    /// Exactly what the user approved for this version.
    pub permissions: Vec<String>,
    pub toolbar: Vec<plugin_package::ToolbarContribution>,
    pub behaviors: Vec<plugin_package::BehaviorContribution>,
    pub overlays: Vec<plugin_package::OverlayContribution>,
    pub tools: Vec<plugin_package::ToolContribution>,
    /// `import` or `local`: where the approved version came from.
    pub origin: String,
    pub source: String,
}

/// Events the renderer may add to the audit trail. Anything else is rejected.
const RENDERER_EVENTS: &[&str] = &["permission_denied", "terminated_by_host", "protocol_violation", "isolation_failed", "plugin_error"];

pub(crate) fn sorted(values: &[String]) -> Vec<String> {
    let mut copy = values.to_vec();
    copy.sort();
    copy.dedup();
    copy
}

/// Loads the registry under the lock, re-verifies installed bytes, applies `change`, saves and
/// audits. A rejected change still persists any `altered` finding made on the way.
fn mutate(
    root: &Path,
    id: &str,
    event: &str,
    change: impl FnOnce(&mut Registry) -> Result<String, String>,
) -> Result<(), String> {
    // Reserved builtin.* ids pass only to be looked up: they exist in the registry solely when
    // the application itself installed them, so an import can never reach them this way.
    plugin_package::validate_id_for(id, true)?;
    let _guard = locked(root)?;
    let mut registry = load_registry(root)?;
    let altered = verify_integrity(root, &mut registry);
    for found in &altered {
        audit(root, "integrity_failed", found, "installed files differ from the recorded fingerprint");
    }
    match change(&mut registry) {
        Ok(detail) => {
            save_registry(root, &registry)?;
            audit(root, event, id, &detail);
            Ok(())
        }
        Err(error) => {
            if !altered.is_empty() {
                let _ = save_registry(root, &registry);
            }
            Err(error)
        }
    }
}

fn record_mut<'a>(registry: &'a mut Registry, id: &str) -> Result<&'a mut PluginRecord, String> {
    registry.plugins.get_mut(id).ok_or_else(|| "That plugin is not installed".to_string())
}

/// Approves exactly one version. The approval is bound to id + version + fingerprint + the full
/// requested permission set + SDK version, and only the newest imported version can be approved.
pub fn grant_consent(root: &Path, id: &str, version: &str, fingerprint: &str, granted: &[String], sdk_version: u32) -> Result<(), String> {
    mutate(root, id, "consent_granted", |registry| {
        let record = record_mut(registry, id)?;
        if record.state == "altered" {
            return Err("The plugin files changed after installation; remove it and import the package again".into());
        }
        let index = record
            .versions
            .iter()
            .position(|v| v.version == version && v.fingerprint == fingerprint)
            .ok_or("That plugin version is not installed")?;
        if record.versions[index].dir != record.latest {
            return Err("Only the newest imported version can be approved".into());
        }
        let entry = &mut record.versions[index];
        if sdk_version != entry.sdk_version {
            return Err("The approval does not match the SDK version of the package".into());
        }
        if sorted(granted) != sorted(&entry.permissions) {
            return Err("The approval must cover exactly the permissions the plugin requests".into());
        }
        entry.granted = sorted(granted);
        entry.consent_at = Some(now());
        let (dir, detail) = (entry.dir.clone(), format!("{version} {}", fingerprint.get(..12).unwrap_or("")));
        record.current = Some(dir);
        // A new approval never starts the plugin by itself.
        record.state = "installed".into();
        Ok(detail)
    })
}

/// Withdraws the approval of the running version and stops it.
pub fn revoke_consent(root: &Path, id: &str) -> Result<(), String> {
    mutate(root, id, "consent_revoked", |registry| {
        let record = record_mut(registry, id)?;
        if let Some(current) = record.current.take() {
            if let Some(entry) = record.versions.iter_mut().find(|v| v.dir == current) {
                entry.granted.clear();
                entry.consent_at = None;
            }
        }
        if record.state != "altered" {
            record.state = "installed".into();
        }
        Ok(String::new())
    })
}

/// Activation requires a current, complete approval and intact files; deactivation always works.
pub fn set_active(root: &Path, id: &str, active: bool) -> Result<(), String> {
    mutate(root, id, if active { "activated" } else { "deactivated" }, |registry| {
        let disabled_all = registry.disabled_all;
        let record = record_mut(registry, id)?;
        // The emergency switch covers imported packages only; local package folders are exempt.
        if active && disabled_all && !exempt_from_switch(record) {
            return Err("External plugins are switched off".into());
        }
        if !active {
            if matches!(record.state.as_str(), "active" | "stopped") {
                record.state = "installed".into();
            }
            return Ok(String::new());
        }
        if record.state == "altered" {
            return Err("The plugin files changed after installation; remove it and import the package again".into());
        }
        let current = record.current.clone().ok_or("Approve the plugin before activating it")?;
        let entry = record.versions.iter().find(|v| v.dir == current).ok_or("The approved version is missing")?;
        if entry.consent_at.is_none() || sorted(&entry.granted) != sorted(&entry.permissions) {
            return Err("The approval is incomplete; approve the plugin again".into());
        }
        let detail = format!("{} {}", entry.version, entry.fingerprint.get(..12).unwrap_or(""));
        record.state = "active".into();
        Ok(detail)
    })
}

/// Records that the host terminated a running plugin (watchdog, repeated faults).
pub fn mark_stopped(root: &Path, id: &str, reason: &str) -> Result<(), String> {
    mutate(root, id, "terminated", |registry| {
        let record = record_mut(registry, id)?;
        if record.state == "active" {
            record.state = "stopped".into();
        }
        Ok(reason.chars().take(200).collect())
    })
}

/// The emergency switch. Turning it on also stops every running plugin.
pub fn set_disabled_all(root: &Path, disabled: bool) -> Result<(), String> {
    let _guard = locked(root)?;
    let mut registry = load_registry(root)?;
    registry.disabled_all = disabled;
    if disabled {
        for record in registry.plugins.values_mut().filter(|record| !exempt_from_switch(record)) {
            if record.state == "active" {
                record.state = "installed".into();
            }
        }
    }
    save_registry(root, &registry)?;
    audit(root, if disabled { "kill_switch_on" } else { "kill_switch_off" }, "-", "");
    Ok(())
}

/// Returns the bytes to execute, only for an active plugin whose installed files still match the
/// fingerprint the user approved. Called at every start, so tampering is caught before running.
pub fn read_entry(root: &Path, id: &str) -> Result<EntryPayload, String> {
    // Reserved builtin.* ids pass only to be looked up: they exist in the registry solely when
    // the application itself installed them, so an import can never reach them this way.
    plugin_package::validate_id_for(id, true)?;
    let _guard = locked(root)?;
    let mut registry = load_registry(root)?;
    let altered = verify_integrity(root, &mut registry);
    if !altered.is_empty() {
        save_registry(root, &registry)?;
        for found in &altered {
            audit(root, "integrity_failed", found, "installed files differ from the recorded fingerprint");
        }
    }
    let record = registry.plugins.get(id).ok_or("That plugin is not installed")?;
    if record.state != "active" {
        return Err("The plugin is not active".into());
    }
    let current = record.current.as_deref().ok_or("The plugin has no approved version")?;
    let entry = record.versions.iter().find(|v| v.dir == current).ok_or("The approved version is missing")?;
    if entry.consent_at.is_none() || sorted(&entry.granted) != sorted(&entry.permissions) {
        return Err("The approval is incomplete; approve the plugin again".into());
    }
    let local = entry.source == LOCAL_SOURCE;
    if registry.disabled_all && !local {
        return Err("External plugins are switched off".into());
    }
    let folder = root.join(id).join(&entry.dir);
    let manifest = plugin_package::parse_manifest_for(&read_plain(&folder.join(plugin_package::MANIFEST_ENTRY), plugin_package::MAX_MANIFEST_BYTES)?, local)?;
    if manifest.id != id || manifest.version != entry.version || manifest.sdk_version != entry.sdk_version {
        return Err("The installed manifest does not match the approved version".into());
    }
    let bytes = read_plain(&folder.join(plugin_package::MAIN_ENTRY), plugin_package::MAX_FILE_BYTES)?;
    let source = String::from_utf8(bytes).map_err(|_| "The plugin entry is not valid UTF-8".to_string())?;
    Ok(EntryPayload {
        id: id.to_string(),
        version: entry.version.clone(),
        fingerprint: entry.fingerprint.clone(),
        sdk_version: entry.sdk_version,
        permissions: sorted(&entry.granted),
        toolbar: manifest.contributions.toolbar,
        behaviors: manifest.contributions.behaviors,
        overlays: manifest.contributions.overlays,
        tools: manifest.contributions.tools,
        origin: if local { LOCAL_SOURCE } else { IMPORT_SOURCE }.to_string(),
        source,
    })
}

fn read_plain(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let info = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    crate::safe_copy::reject_special(&info)?;
    if !info.is_file() || info.len() > limit {
        return Err("A plugin file is missing, not a regular file, or too large".into());
    }
    fs::read(path).map_err(|error| error.to_string())
}

/// Lets the renderer add allow-listed events (denied permission, forced termination) to the
/// audit trail for a plugin that exists. Details are truncated by `audit`.
pub fn log_event(root: &Path, id: &str, event: &str, detail: &str) -> Result<(), String> {
    // Reserved builtin.* ids pass only to be looked up: they exist in the registry solely when
    // the application itself installed them, so an import can never reach them this way.
    plugin_package::validate_id_for(id, true)?;
    if !RENDERER_EVENTS.contains(&event) {
        return Err("Unknown audit event".into());
    }
    let _guard = locked(root)?;
    if !load_registry(root)?.plugins.contains_key(id) {
        return Err("That plugin is not installed".into());
    }
    audit(root, event, id, detail);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use zip::{write::SimpleFileOptions, ZipWriter};

    struct Scratch(PathBuf);
    impl Scratch {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir().join(format!("grimoire-plugin-registry-{tag}-{}-{}", std::process::id(), nonce()));
            fs::create_dir_all(&path).unwrap();
            Scratch(path)
        }
        fn root(&self) -> PathBuf {
            self.0.join("managed")
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn manifest(version: &str) -> String {
        format!(r#"{{"schemaVersion":1,"sdkVersion":1,"id":"community.zoom","name":"Zoom","version":"{version}","author":"A","description":"D","main":"dist/index.js","permissions":["editor:zoom:read"]}}"#)
    }

    fn package(scratch: &Scratch, name: &str, version: &str, code: &str) -> PathBuf {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer.start_file("manifest.json", SimpleFileOptions::default()).unwrap();
        writer.write_all(manifest(version).as_bytes()).unwrap();
        writer.start_file("dist/index.js", SimpleFileOptions::default()).unwrap();
        writer.write_all(code.as_bytes()).unwrap();
        let path = scratch.0.join(name);
        fs::write(&path, writer.finish().unwrap().into_inner()).unwrap();
        path
    }

    fn run(root: &Path, zip: &Path) -> Result<InstallResult, String> {
        install(root, zip, Duration::from_secs(30))
    }

    #[test]
    fn installs_unapproved_and_inactive_and_leaves_no_staging() {
        let scratch = Scratch::new("install");
        let root = scratch.root();
        let result = run(&root, &package(&scratch, "a.zip", "1.0.0", "a")).unwrap();
        assert!(!result.already_installed);
        let registry = load_registry(&root).unwrap();
        let record = &registry.plugins["community.zoom"];
        assert_eq!(record.current, None, "an install never approves a plugin");
        assert_eq!(record.versions[0].granted, Vec::<String>::new());
        assert!(root.join("community.zoom").join(&record.latest).join("dist/index.js").is_file());
        assert!(fs::read_dir(&root).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().starts_with(STAGING_PREFIX)));
        assert!(run(&root, &package(&scratch, "again.zip", "1.0.0", "a")).unwrap().already_installed);
        assert_eq!(load_registry(&root).unwrap().plugins["community.zoom"].versions.len(), 1);
    }

    #[test]
    fn an_update_keeps_the_previous_version_and_approval_untouched() {
        let scratch = Scratch::new("update");
        let root = scratch.root();
        run(&root, &package(&scratch, "a.zip", "1.0.0", "old")).unwrap();
        let mut registry = load_registry(&root).unwrap();
        let first = registry.plugins["community.zoom"].latest.clone();
        registry.plugins.get_mut("community.zoom").unwrap().current = Some(first.clone());
        save_registry(&root, &registry).unwrap();

        run(&root, &package(&scratch, "b.zip", "1.1.0", "new")).unwrap();
        let record = &load_registry(&root).unwrap().plugins["community.zoom"];
        assert_eq!(record.current.as_deref(), Some(first.as_str()), "approval stays on the old bytes");
        assert_ne!(record.latest, first);
        assert_eq!(fs::read(root.join("community.zoom").join(&first).join("dist/index.js")).unwrap(), b"old");
        assert_eq!(fs::read(root.join("community.zoom").join(&record.latest).join("dist/index.js")).unwrap(), b"new");
    }

    #[test]
    fn a_rejected_package_changes_nothing() {
        let scratch = Scratch::new("reject");
        let root = scratch.root();
        run(&root, &package(&scratch, "a.zip", "1.0.0", "old")).unwrap();
        let before = fs::read(root.join(REGISTRY)).unwrap();
        let bad = scratch.0.join("bad.zip");
        fs::write(&bad, b"not a zip").unwrap();
        assert!(run(&root, &bad).is_err());
        assert_eq!(fs::read(root.join(REGISTRY)).unwrap(), before);
        assert!(fs::read_dir(&root).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().starts_with(STAGING_PREFIX)));
    }

    #[test]
    fn a_failed_registry_publish_withdraws_the_new_version() {
        let scratch = Scratch::new("rollback");
        let root = scratch.root();
        run(&root, &package(&scratch, "a.zip", "1.0.0", "old")).unwrap();
        let before = fs::read(root.join(REGISTRY)).unwrap();
        fs::create_dir(root.join(REGISTRY_TMP)).unwrap(); // makes the temp-file write fail
        assert!(run(&root, &package(&scratch, "b.zip", "1.1.0", "new")).is_err());
        assert_eq!(fs::read(root.join(REGISTRY)).unwrap(), before);
        let entries: Vec<_> = fs::read_dir(root.join("community.zoom")).unwrap().flatten().collect();
        assert_eq!(entries.len(), 1, "only the original version remains");
    }

    #[test]
    fn a_damaged_registry_is_preserved_and_blocks_installs() {
        let scratch = Scratch::new("damaged");
        let root = scratch.root();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join(REGISTRY), b"{ broken").unwrap();
        assert!(run(&root, &package(&scratch, "a.zip", "1.0.0", "a")).is_err());
        assert_eq!(fs::read(root.join(REGISTRY)).unwrap(), b"{ broken");
        assert!(!root.join("community.zoom").exists());
    }

    #[test]
    fn recovery_removes_only_staging_and_temp_never_installed_files() {
        let scratch = Scratch::new("recover");
        let root = scratch.root();
        run(&root, &package(&scratch, "a.zip", "1.0.0", "a")).unwrap();
        let kept = load_registry(&root).unwrap().plugins["community.zoom"].latest.clone();
        fs::create_dir_all(root.join(".staging-1-1/dist")).unwrap();
        fs::write(root.join(REGISTRY_TMP), "x").unwrap();
        fs::create_dir_all(root.join("community.zoom/2.0.0-abcdef012345")).unwrap();
        fs::create_dir_all(root.join("unrelated-folder")).unwrap();
        fs::write(root.join("unrelated-folder/notes.txt"), "mine").unwrap();
        recover(&root).unwrap();
        assert!(!root.join(".staging-1-1").exists());
        assert!(!root.join(REGISTRY_TMP).exists());
        assert!(root.join("community.zoom").join(&kept).is_dir());
        assert!(root.join("community.zoom/2.0.0-abcdef012345").is_dir(), "unreferenced versions are kept");
        assert!(root.join("unrelated-folder/notes.txt").is_file());
    }

    #[test]
    fn a_lost_registry_never_deletes_installed_files_and_a_matching_reinstall_reuses_them() {
        let scratch = Scratch::new("lost");
        let root = scratch.root();
        let zip = package(&scratch, "a.zip", "1.0.0", "keep me");
        run(&root, &zip).unwrap();
        let dir = load_registry(&root).unwrap().plugins["community.zoom"].latest.clone();
        fs::remove_file(root.join(REGISTRY)).unwrap();
        assert!(list(&root).unwrap().plugins.is_empty());
        let file = root.join("community.zoom").join(&dir).join("dist/index.js");
        assert_eq!(fs::read(&file).unwrap(), b"keep me");

        assert!(!run(&root, &zip).unwrap().already_installed);
        assert_eq!(load_registry(&root).unwrap().plugins["community.zoom"].latest, dir);
        assert_eq!(fs::read(&file).unwrap(), b"keep me");

        // Different bytes under the same name are refused, never merged or overwritten.
        fs::remove_file(root.join(REGISTRY)).unwrap();
        fs::write(&file, "swapped").unwrap();
        assert!(run(&root, &zip).is_err());
        assert_eq!(fs::read(&file).unwrap(), b"swapped");
    }

    #[test]
    fn tampered_files_are_flagged_and_lose_their_approval() {
        let scratch = Scratch::new("integrity");
        let root = scratch.root();
        run(&root, &package(&scratch, "a.zip", "1.0.0", "safe")).unwrap();
        let mut registry = load_registry(&root).unwrap();
        let dir = registry.plugins["community.zoom"].latest.clone();
        registry.plugins.get_mut("community.zoom").unwrap().current = Some(dir.clone());
        save_registry(&root, &registry).unwrap();
        assert_eq!(list(&root).unwrap().plugins["community.zoom"].state, "installed", "untouched files verify");

        fs::write(root.join("community.zoom").join(&dir).join("dist/index.js"), "evil").unwrap();
        let record = &list(&root).unwrap().plugins["community.zoom"];
        assert_eq!(record.state, "altered");
        assert_eq!(record.current, None, "approval is withdrawn for changed bytes");
        assert_eq!(load_registry(&root).unwrap().plugins["community.zoom"].state, "altered", "the finding is persisted");
        assert!(fs::read_to_string(root.join("audit.log")).unwrap().contains("integrity_failed"));

        // An extra file is also a change; a clean reinstall after removal restores the plugin.
        remove(&root, "community.zoom").unwrap();
        run(&root, &package(&scratch, "again.zip", "1.0.0", "safe")).unwrap();
        assert_eq!(list(&root).unwrap().plugins["community.zoom"].state, "installed");
        let dir = load_registry(&root).unwrap().plugins["community.zoom"].latest.clone();
        fs::write(root.join("community.zoom").join(&dir).join("dist/extra.js"), "x").unwrap();
        assert_eq!(list(&root).unwrap().plugins["community.zoom"].state, "altered");
    }

    #[test]
    fn the_audit_trail_records_outcomes_and_cannot_fail_an_install() {
        let scratch = Scratch::new("audit");
        let root = scratch.root();
        run(&root, &package(&scratch, "a.zip", "1.0.0", "a")).unwrap();
        let bad = scratch.0.join("bad.zip");
        fs::write(&bad, b"nope").unwrap();
        assert!(run(&root, &bad).is_err());
        remove(&root, "community.zoom").unwrap();
        let log = fs::read_to_string(root.join("audit.log")).unwrap();
        for event in ["\"installed\"", "\"install_rejected\"", "\"removed\""] {
            assert!(log.contains(event), "missing {event} in {log}");
        }
        // A directory in place of the log makes auditing impossible; the install still succeeds.
        fs::remove_file(root.join("audit.log")).unwrap();
        fs::create_dir(root.join("audit.log")).unwrap();
        run(&root, &package(&scratch, "b.zip", "1.0.0", "a")).unwrap();
    }

    #[test]
    fn remove_unregisters_then_deletes_and_rejects_unsafe_ids() {
        let scratch = Scratch::new("remove");
        let root = scratch.root();
        run(&root, &package(&scratch, "a.zip", "1.0.0", "a")).unwrap();
        fs::create_dir_all(root.join("other")).unwrap();
        for id in ["..", "builtin.zoom", "Zoom", ""] {
            assert!(remove(&root, id).is_err());
        }
        assert!(root.join("other").is_dir());
        assert!(remove(&root, "missing.plugin").is_err());
        remove(&root, "community.zoom").unwrap();
        assert!(load_registry(&root).unwrap().plugins.is_empty());
        assert!(!root.join("community.zoom").exists());
        assert!(root.join("other").is_dir());
    }

    const ID: &str = "community.zoom";

    /// Installs one version and returns (version, fingerprint) of the installed record.
    fn install_version(scratch: &Scratch, root: &Path, version: &str, code: &str) -> (String, String) {
        run(root, &package(scratch, &format!("{version}-{code}.zip"), version, code)).unwrap();
        let registry = load_registry(root).unwrap();
        let latest = &registry.plugins[ID].latest;
        let entry = registry.plugins[ID].versions.iter().find(|v| &v.dir == latest).unwrap();
        (entry.version.clone(), entry.fingerprint.clone())
    }

    fn approve(root: &Path, version: &str, fingerprint: &str) -> Result<(), String> {
        grant_consent(root, ID, version, fingerprint, &["editor:zoom:read".to_string()], 1)
    }

    #[test]
    fn activation_needs_a_complete_approval_bound_to_version_fingerprint_and_sdk() {
        let scratch = Scratch::new("consent");
        let root = scratch.root();
        let (version, fingerprint) = install_version(&scratch, &root, "1.0.0", "console.log(1)");
        assert!(set_active(&root, ID, true).is_err(), "no approval, no activation");
        assert!(grant_consent(&root, ID, &version, &fingerprint, &[], 1).is_err(), "must cover every requested permission");
        assert!(grant_consent(&root, ID, &version, &fingerprint, &["editor:zoom:read".into(), "editor:zoom:write".into()], 1).is_err());
        assert!(grant_consent(&root, ID, &version, &fingerprint, &["editor:zoom:read".into()], 2).is_err(), "wrong SDK");
        assert!(grant_consent(&root, ID, &version, &"0".repeat(64), &["editor:zoom:read".into()], 1).is_err(), "wrong fingerprint");
        assert!(grant_consent(&root, ID, "9.9.9", &fingerprint, &["editor:zoom:read".into()], 1).is_err(), "wrong version");
        assert!(grant_consent(&root, "community.missing", &version, &fingerprint, &[], 1).is_err());
        assert_eq!(load_registry(&root).unwrap().plugins[ID].current, None, "rejected approvals change nothing");

        approve(&root, &version, &fingerprint).unwrap();
        let record = load_registry(&root).unwrap().plugins.remove(ID).unwrap();
        assert_eq!((record.state.as_str(), record.current.is_some()), ("installed", true), "approval does not start the plugin");
        assert!(read_entry(&root, ID).is_err(), "not active yet");

        set_active(&root, ID, true).unwrap();
        let entry = read_entry(&root, ID).unwrap();
        assert_eq!((entry.version.as_str(), entry.source.as_str(), entry.sdk_version), ("1.0.0", "console.log(1)", 1));
        assert_eq!(entry.permissions, vec!["editor:zoom:read".to_string()]);

        set_active(&root, ID, false).unwrap();
        assert!(read_entry(&root, ID).is_err(), "a deactivated plugin is never read");
        assert_eq!(load_registry(&root).unwrap().plugins[ID].state, "installed");
        let log = fs::read_to_string(root.join("audit.log")).unwrap();
        for event in ["consent_granted", "activated", "deactivated"] {
            assert!(log.contains(event), "missing {event}");
        }
    }

    #[test]
    fn an_update_never_inherits_the_previous_approval() {
        let scratch = Scratch::new("update");
        let root = scratch.root();
        let (v1, f1) = install_version(&scratch, &root, "1.0.0", "old");
        approve(&root, &v1, &f1).unwrap();
        set_active(&root, ID, true).unwrap();

        let (v2, f2) = install_version(&scratch, &root, "1.1.0", "new");
        assert_eq!(read_entry(&root, ID).unwrap().source, "old", "the approved bytes keep running, the update does not");
        assert!(approve(&root, &v1, &f1).is_err(), "an older version cannot be approved over a newer import");
        approve(&root, &v2, &f2).unwrap();
        assert_eq!(load_registry(&root).unwrap().plugins[ID].state, "installed", "approving an update stops the old one");
        assert!(read_entry(&root, ID).is_err());
        set_active(&root, ID, true).unwrap();
        assert_eq!(read_entry(&root, ID).unwrap().source, "new");
    }

    #[test]
    fn changed_bytes_block_reading_and_activation() {
        let scratch = Scratch::new("tamper-run");
        let root = scratch.root();
        let (version, fingerprint) = install_version(&scratch, &root, "1.0.0", "safe");
        approve(&root, &version, &fingerprint).unwrap();
        set_active(&root, ID, true).unwrap();
        let dir = load_registry(&root).unwrap().plugins[ID].latest.clone();
        fs::write(root.join(ID).join(&dir).join("dist/index.js"), "evil").unwrap();

        assert!(read_entry(&root, ID).is_err(), "tampered bytes are never handed to the runtime");
        let record = load_registry(&root).unwrap().plugins.remove(ID).unwrap();
        assert_eq!((record.state.as_str(), record.current), ("altered", None));
        assert!(set_active(&root, ID, true).is_err());
        assert!(approve(&root, &version, &fingerprint).is_err(), "an altered plugin cannot be approved again");
    }

    #[test]
    fn revoking_consent_stops_the_plugin_and_withdraws_the_grant() {
        let scratch = Scratch::new("revoke");
        let root = scratch.root();
        let (version, fingerprint) = install_version(&scratch, &root, "1.0.0", "x");
        approve(&root, &version, &fingerprint).unwrap();
        set_active(&root, ID, true).unwrap();
        revoke_consent(&root, ID).unwrap();
        let record = load_registry(&root).unwrap().plugins.remove(ID).unwrap();
        assert_eq!((record.state.as_str(), record.current.as_deref()), ("installed", None));
        assert!(record.versions[0].granted.is_empty() && record.versions[0].consent_at.is_none());
        assert!(set_active(&root, ID, true).is_err() && read_entry(&root, ID).is_err());
    }

    #[test]
    fn the_kill_switch_stops_everything_and_blocks_activation_until_cleared() {
        let scratch = Scratch::new("kill");
        let root = scratch.root();
        let (version, fingerprint) = install_version(&scratch, &root, "1.0.0", "x");
        approve(&root, &version, &fingerprint).unwrap();
        set_active(&root, ID, true).unwrap();

        set_disabled_all(&root, true).unwrap();
        assert_eq!(load_registry(&root).unwrap().plugins[ID].state, "installed");
        assert!(set_active(&root, ID, true).is_err() && read_entry(&root, ID).is_err());
        set_disabled_all(&root, false).unwrap();
        set_active(&root, ID, true).unwrap();
        assert!(read_entry(&root, ID).is_ok());
        assert!(fs::read_to_string(root.join("audit.log")).unwrap().contains("kill_switch_on"));
    }

    #[test]
    fn a_stopped_plugin_can_be_started_again_only_by_an_explicit_activation() {
        let scratch = Scratch::new("stopped");
        let root = scratch.root();
        let (version, fingerprint) = install_version(&scratch, &root, "1.0.0", "x");
        approve(&root, &version, &fingerprint).unwrap();
        set_active(&root, ID, true).unwrap();
        mark_stopped(&root, ID, "watchdog timeout").unwrap();
        assert_eq!(load_registry(&root).unwrap().plugins[ID].state, "stopped");
        assert!(read_entry(&root, ID).is_err(), "a stopped plugin is not read at startup");
        set_active(&root, ID, true).unwrap();
        assert!(read_entry(&root, ID).is_ok());
        assert!(fs::read_to_string(root.join("audit.log")).unwrap().contains("watchdog timeout"));
    }

    #[test]
    fn renderer_audit_events_are_allow_listed_and_need_an_installed_plugin() {
        let scratch = Scratch::new("events");
        let root = scratch.root();
        install_version(&scratch, &root, "1.0.0", "x");
        log_event(&root, ID, "permission_denied", "editor:zoom:write").unwrap();
        assert!(fs::read_to_string(root.join("audit.log")).unwrap().contains("permission_denied"));
        assert!(log_event(&root, ID, "installed", "forged").is_err(), "the renderer cannot write native events");
        assert!(log_event(&root, "community.missing", "permission_denied", "x").is_err());
        assert!(log_event(&root, "..", "permission_denied", "x").is_err());
    }

    #[test]
    fn a_registry_without_the_new_fields_still_loads_with_safe_defaults() {
        let scratch = Scratch::new("legacy");
        let root = scratch.root();
        install_version(&scratch, &root, "1.0.0", "x");
        let text = fs::read_to_string(root.join("registry.json")).unwrap();
        let mut value: serde_json::Value = serde_json::from_str(&text).unwrap();
        value.as_object_mut().unwrap().remove("disabledAll");
        for version in value["plugins"][ID]["versions"].as_array_mut().unwrap() {
            let fields = version.as_object_mut().unwrap();
            fields.remove("sdkVersion");
            fields.remove("consentAt");
        }
        fs::write(root.join("registry.json"), value.to_string()).unwrap();
        let registry = load_registry(&root).unwrap();
        assert!(!registry.disabled_all);
        assert_eq!((registry.plugins[ID].versions[0].sdk_version, registry.plugins[ID].versions[0].consent_at), (1, None));
    }
}
