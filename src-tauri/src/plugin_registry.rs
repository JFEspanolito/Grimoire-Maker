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
const STAGING_PREFIX: &str = ".staging-";
const MAX_REGISTRY_BYTES: u64 = 4 * 1024 * 1024;
static INSTALL_LOCK: Mutex<()> = Mutex::new(());

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
    pub installed_at: u64,
    pub source: String,
    #[serde(default)]
    pub signature: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginRecord {
    pub latest: String,
    #[serde(default)]
    pub current: Option<String>,
    /// `installed` until the integrity check marks it `altered`.
    pub state: String,
    pub versions: Vec<VersionRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Registry {
    pub version: u32,
    pub plugins: BTreeMap<String, PluginRecord>,
}

impl Default for Registry {
    fn default() -> Self {
        Registry { version: 1, plugins: BTreeMap::new() }
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

fn lock() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    INSTALL_LOCK.lock().map_err(|error| error.to_string())
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
fn save_registry(root: &Path, registry: &Registry) -> Result<(), String> {
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

fn is_version_dir(name: &str) -> bool {
    name.rsplit_once('-').is_some_and(|(_, fp)| fp.len() == 12 && fp.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')))
}

fn plain_dir(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|info| info.is_dir() && crate::safe_copy::reject_special(&info).is_ok())
}

fn only_version_dirs(path: &Path) -> bool {
    let Ok(children) = fs::read_dir(path) else { return false };
    let names: Vec<_> = children.flatten().collect();
    !names.is_empty() && names.iter().all(|child| is_version_dir(&child.file_name().to_string_lossy()) && plain_dir(&child.path()))
}

/// Removes only our own leftovers: staging directories, the temp registry and unreferenced
/// version directories. Referenced versions and unknown entries are never touched.
fn recover_locked(root: &Path, registry: &Registry) -> Result<(), String> {
    let entries = fs::read_dir(root).map_err(|error| error.to_string())?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        if name.starts_with(STAGING_PREFIX) && plain_dir(&path) {
            let _ = fs::remove_dir_all(&path);
        } else if name == REGISTRY_TMP {
            let _ = fs::remove_file(&path);
        } else if !registry.plugins.contains_key(&name) {
            // A plugin folder whose record is gone (an interrupted removal) holding only version
            // directories; anything else in the managed root is left alone.
            if plugin_package::validate_id(&name).is_ok() && plain_dir(&path) && only_version_dirs(&path) {
                let _ = fs::remove_dir_all(&path);
            }
        } else if let Some(record) = registry.plugins.get(&name) {
            if !plain_dir(&path) {
                continue;
            }
            for version in fs::read_dir(&path).map_err(|error| error.to_string())?.flatten() {
                let dir = version.file_name().to_string_lossy().into_owned();
                if is_version_dir(&dir) && plain_dir(&version.path()) && !record.versions.iter().any(|v| v.dir == dir) {
                    let _ = fs::remove_dir_all(version.path());
                }
            }
        }
    }
    Ok(())
}

pub fn recover(root: &Path) -> Result<(), String> {
    let _guard = lock()?;
    prepare_root(root)?;
    recover_locked(root, &load_registry(root)?)
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn nonce() -> u128 {
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
    let _guard = lock()?;
    prepare_root(root)?;
    let mut registry = load_registry(root)?;
    recover_locked(root, &registry)?;

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
    let published = publish(&staging, &plugin_dir, &dir);
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
        installed_at: now(),
        source: "import".into(),
        signature: None,
    });
    if let Err(error) = save_registry(root, &registry) {
        // The registry still describes the previous state: withdraw the version we just published.
        let _ = fs::remove_dir_all(plugin_dir.join(&dir));
        if created_plugin_dir {
            let _ = fs::remove_dir(&plugin_dir);
        }
        return Err(error);
    }
    Ok(summary(false))
}

/// Moves the validated staging directory to its final immutable location, never overwriting.
fn publish(staging: &Path, plugin_dir: &Path, dir: &str) -> Result<(), String> {
    fs::create_dir_all(plugin_dir).map_err(|error| error.to_string())?;
    let info = fs::symlink_metadata(plugin_dir).map_err(|error| error.to_string())?;
    crate::safe_copy::reject_special(&info)?;
    if !info.is_dir() {
        return Err("The plugin folder is not a directory".into());
    }
    let destination = plugin_dir.join(dir);
    if destination.exists() {
        return Err("That plugin version already exists on disk but is not registered".into());
    }
    fs::rename(staging, destination).map_err(|error| format!("Could not publish the plugin: {error}"))
}

pub fn list(root: &Path) -> Result<Registry, String> {
    let _guard = lock()?;
    prepare_root(root)?;
    let mut registry = load_registry(root)?;
    recover_locked(root, &registry)?;
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
fn audit(root: &Path, event: &str, id: &str, detail: &str) {
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

/// Updates the registry first, then deletes the plugin's own folder; a failed delete leaves an
/// unreferenced folder that the next recovery pass deletes.
pub fn remove(root: &Path, id: &str) -> Result<(), String> {
    plugin_package::validate_id(id)?;
    let _guard = lock()?;
    prepare_root(root)?;
    let mut registry = load_registry(root)?;
    if registry.plugins.remove(id).is_none() {
        return Err("That plugin is not installed".into());
    }
    save_registry(root, &registry)?;
    audit(root, "removed", id, "");
    let folder: PathBuf = root.join(id);
    if plain_dir(&folder) {
        fs::remove_dir_all(&folder).map_err(|error| format!("The plugin was unregistered but its files could not be deleted: {error}"))?;
    }
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
    fn recovery_removes_only_staging_temp_and_unreferenced_versions() {
        let scratch = Scratch::new("recover");
        let root = scratch.root();
        run(&root, &package(&scratch, "a.zip", "1.0.0", "a")).unwrap();
        let kept = load_registry(&root).unwrap().plugins["community.zoom"].latest.clone();
        fs::create_dir_all(root.join(".staging-1-1/dist")).unwrap();
        fs::write(root.join(REGISTRY_TMP), "x").unwrap();
        fs::create_dir_all(root.join("community.zoom/2.0.0-abcdef012345")).unwrap();
        fs::create_dir_all(root.join("community.zoom/notes")).unwrap();
        fs::create_dir_all(root.join("unrelated-folder")).unwrap();
        fs::write(root.join("unrelated-folder/notes.txt"), "mine").unwrap();
        fs::create_dir_all(root.join("gone.plugin/1.0.0-0123456789ab")).unwrap(); // interrupted removal
        recover(&root).unwrap();
        assert!(!root.join("gone.plugin").exists());
        assert!(!root.join(".staging-1-1").exists());
        assert!(!root.join(REGISTRY_TMP).exists());
        assert!(!root.join("community.zoom/2.0.0-abcdef012345").exists());
        assert!(root.join("community.zoom").join(&kept).is_dir());
        assert!(root.join("community.zoom/notes").is_dir(), "unknown entries are not ours to delete");
        assert!(root.join("unrelated-folder").is_dir());
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
}
