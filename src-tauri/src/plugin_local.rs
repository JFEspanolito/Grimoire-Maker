//! Plugin packages that run straight from folders in Mods/Plugins.
//!
//! A subfolder with a regular `manifest.json` is a package folder. Only `manifest.json` and
//! `dist/**` are used (everything else in the folder is ignored) and they are validated with the
//! same limits as an imported ZIP. A valid folder is copied into the managed root as an immutable
//! `<id>/<version>-<fingerprint12>/` directory and recorded with `source = "local"`, approved for
//! exactly its manifest permissions: the user put the folder there. The plugin still runs in the
//! isolated runtime like any other external plugin.
use crate::plugin_package::{self as package, Manifest};
use crate::plugin_registry::{self as registry, PluginRecord, Registry, VersionRecord, IMPORT_SOURCE, LOCAL_SOURCE};
use crate::{plugin_install, safe_copy};
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

const MAX_FOLDERS: usize = 64;
const LEGACY_SOURCE: &str = "bundled";
const DIST: &str = "dist";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalPackage {
    pub folder: String,
    pub id: String,
    pub version: String,
    pub fingerprint: String,
    /// True only when this call published a new directory or moved the record's `current`.
    pub changed: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalError {
    pub folder: String,
    pub message: String,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub packages: Vec<LocalPackage>,
    pub errors: Vec<LocalError>,
}

pub type LocalSyncResult = SyncResult;

/// One folder read completely into memory, so what is validated is exactly what is copied.
struct Package {
    manifest: Manifest,
    manifest_bytes: Vec<u8>,
    dirs: Vec<String>,
    files: Vec<(String, Vec<u8>)>,
}

/// The plugins folder the renderer names must not be (or sit inside) the managed storage.
pub fn ensure_outside_managed(root: &Path, plugins_dir: &Path) -> Result<(), String> {
    registry::prepare_root(root)?;
    // Canonicalizes the deepest existing ancestor so a missing tail cannot dodge the comparison.
    let canonical = |path: &Path| {
        let mut tail = Vec::new();
        let mut current = path;
        loop {
            if let Ok(real) = fs::canonicalize(current) {
                return tail.iter().rev().fold(real, |acc, part: &&std::ffi::OsStr| acc.join(part));
            }
            match (current.parent(), current.file_name()) {
                (Some(parent), Some(name)) => {
                    tail.push(name);
                    current = parent;
                }
                _ => return path.to_path_buf(),
            }
        }
    };
    if canonical(plugins_dir).starts_with(canonical(root)) {
        return Err("The plugins folder cannot be the managed plugin storage".into());
    }
    Ok(())
}

fn read_file(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let file = safe_copy::open_checked(path, false)?;
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes).map_err(|error| error.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("A file exceeds its size budget".into());
    }
    Ok(bytes)
}

/// Immediate subfolders that hold a `manifest.json` (a link there is reported later, as an
/// error for that folder). Hidden folders, links and plain files are skipped.
fn scan(plugins_dir: &Path) -> Result<Vec<(String, PathBuf)>, String> {
    let mut found = Vec::new();
    for entry in fs::read_dir(plugins_dir).map_err(|error| format!("Could not read the plugins folder: {error}"))?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let plain = fs::symlink_metadata(&path).is_ok_and(|info| info.is_dir() && safe_copy::reject_special(&info).is_ok());
        if plain && fs::symlink_metadata(path.join(package::MANIFEST_ENTRY)).is_ok() {
            found.push((name, path));
        }
    }
    found.sort();
    Ok(found)
}

struct Walk {
    entries: usize,
    total: u64,
    keys: HashSet<String>,
    dirs: Vec<String>,
    files: Vec<(String, Vec<u8>)>,
}

fn walk(folder: &Path, relative: &str, state: &mut Walk) -> Result<(), String> {
    for entry in fs::read_dir(folder).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name().into_string().map_err(|_| format!("A file name in '{relative}' is not valid text"))?;
        let child = format!("{relative}/{name}");
        state.entries += 1;
        if state.entries > package::MAX_ENTRIES {
            return Err(format!("Package has more than {} entries", package::MAX_ENTRIES));
        }
        let path = package::validate_entry_path(&child)?;
        let info = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
        safe_copy::reject_special(&info).map_err(|_| format!("Package entry '{path}' is a link or special file"))?;
        let is_dir = info.is_dir();
        package::validate_layout(&path, is_dir)?;
        if !state.keys.insert(path.to_lowercase()) {
            return Err(format!("Package has duplicate entries for '{path}' (names are compared ignoring case)"));
        }
        if is_dir {
            state.dirs.push(path.clone());
            walk(&entry.path(), &path, state)?;
        } else {
            if info.len() > package::MAX_FILE_BYTES {
                return Err(format!("Package entry '{path}' exceeds the file size budget"));
            }
            let bytes = read_file(&entry.path(), package::MAX_FILE_BYTES).map_err(|error| format!("'{path}': {error}"))?;
            state.total += bytes.len() as u64;
            if state.total > package::MAX_TOTAL_BYTES {
                return Err("The package exceeds the total size budget".into());
            }
            state.files.push((path, bytes));
        }
    }
    Ok(())
}

/// Validates one package folder with the rules and limits of an import. The first hostile or
/// ambiguous entry rejects the whole folder.
fn read_package(folder: &Path) -> Result<Package, String> {
    let manifest_bytes = read_file(&folder.join(package::MANIFEST_ENTRY), package::MAX_MANIFEST_BYTES)
        .map_err(|error| format!("manifest.json: {error}"))?;
    let manifest = package::parse_manifest_for(&manifest_bytes, true)?;
    let dist = folder.join(DIST);
    let info = fs::symlink_metadata(&dist).map_err(|_| "The dist/ folder is missing".to_string())?;
    safe_copy::reject_special(&info).map_err(|_| "dist is a link or special file".to_string())?;
    if !info.is_dir() {
        return Err("dist must be a folder".into());
    }
    let mut state = Walk { entries: 2, total: manifest_bytes.len() as u64, keys: HashSet::new(), dirs: Vec::new(), files: Vec::new() };
    state.keys.insert(package::MANIFEST_ENTRY.to_lowercase());
    state.keys.insert(DIST.to_string());
    walk(&dist, DIST, &mut state)?;
    if !state.files.iter().any(|(path, _)| path == package::MAIN_ENTRY) {
        return Err("Package must contain dist/index.js".into());
    }
    Ok(Package { manifest, manifest_bytes, dirs: state.dirs, files: state.files })
}

/// Writes the package into a fresh `.staging-local-*` directory and fingerprints it.
fn stage(root: &Path, package: &Package, index: usize) -> Result<(PathBuf, String), String> {
    let staging = root.join(format!("{}local-{}-{}-{index}", registry::STAGING_PREFIX, std::process::id(), registry::nonce()));
    fs::create_dir(&staging).map_err(|error| format!("Could not create staging directory: {error}"))?;
    let written = write_staging(&staging, package).and_then(|_| plugin_install::fingerprint_dir(&staging));
    match written {
        Ok(fingerprint) => Ok((staging, fingerprint)),
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            Err(error)
        }
    }
}

fn write_staging(staging: &Path, package: &Package) -> Result<(), String> {
    let put = |relative: &str, bytes: &[u8]| -> Result<(), String> {
        let target = staging.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(|error| error.to_string())?;
        file.write_all(bytes).and_then(|_| file.sync_all()).map_err(|error| error.to_string())
    };
    for dir in &package.dirs {
        fs::create_dir_all(staging.join(dir)).map_err(|error| error.to_string())?;
    }
    put(package::MANIFEST_ENTRY, &package.manifest_bytes)?;
    for (path, bytes) in &package.files {
        put(path, bytes)?;
    }
    Ok(())
}

fn short(fingerprint: &str) -> &str {
    fingerprint.get(..12).unwrap_or(fingerprint)
}

/// Publishes one validated folder and updates its record. Returns whether anything changed.
fn publish_one(root: &Path, reg: &mut Registry, folder: &str, package: &Package, index: usize) -> Result<LocalPackage, String> {
    let manifest = &package.manifest;
    if reg.plugins.get(&manifest.id).is_some_and(|record| record.versions.iter().any(|v| v.source == IMPORT_SOURCE)) {
        return Err("That id is already used by an imported plugin".into());
    }
    let (staging, fingerprint) = stage(root, package, index)?;
    let dir = format!("{}-{}", manifest.version, short(&fingerprint));
    let plugin_dir = root.join(&manifest.id);
    let destination = plugin_dir.join(&dir);

    // Our own earlier copy that no longer matches its fingerprint is rebuilt from the folder.
    let known = reg.plugins.get(&manifest.id).is_some_and(|r| r.versions.iter().any(|v| v.dir == dir && v.source == LOCAL_SOURCE));
    if known
        && destination.exists()
        && plugin_install::fingerprint_dir(&destination).as_deref() != Ok(fingerprint.as_str())
        && registry::plain_dir(&plugin_dir)
        && registry::plain_dir(&destination)
    {
        if let Err(error) = fs::remove_dir_all(&destination) {
            let _ = fs::remove_dir_all(&staging);
            return Err(format!("Could not repair the synced copy: {error}"));
        }
    }

    let created_plugin_dir = !plugin_dir.exists();
    let reused = match registry::publish(&staging, &plugin_dir, &dir, &fingerprint) {
        Ok(reused) => reused,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            if created_plugin_dir {
                let _ = fs::remove_dir(&plugin_dir);
            }
            return Err(error);
        }
    };

    let before = reg.plugins.get(&manifest.id).cloned();
    let granted = registry::sorted(&manifest.permissions);
    let version = VersionRecord {
        dir: dir.clone(),
        version: manifest.version.clone(),
        fingerprint: fingerprint.clone(),
        name: manifest.name.clone(),
        author: manifest.author.clone(),
        description: manifest.description.clone(),
        permissions: manifest.permissions.clone(),
        granted: granted.clone(),
        sdk_version: manifest.sdk_version,
        consent_at: Some(registry::now()),
        installed_at: registry::now(),
        source: LOCAL_SOURCE.into(),
        signature: None,
        local_folder: Some(folder.to_string()),
    };
    match reg.plugins.get_mut(&manifest.id) {
        None => {
            reg.plugins.insert(
                manifest.id.clone(),
                PluginRecord { latest: dir.clone(), current: Some(dir.clone()), state: "installed".into(), versions: vec![version] },
            );
        }
        Some(record) => {
            match record.versions.iter_mut().find(|v| v.dir == dir) {
                None => record.versions.push(version),
                Some(entry) => {
                    // Keep the original timestamps; restore only what the approval must hold.
                    if entry.source != LOCAL_SOURCE
                        || entry.local_folder.as_deref() != Some(folder)
                        || entry.granted != granted
                        || entry.consent_at.is_none()
                    {
                        entry.source = LOCAL_SOURCE.into();
                        entry.local_folder = Some(folder.to_string());
                        entry.granted = granted;
                        entry.consent_at = entry.consent_at.or(Some(registry::now()));
                    }
                }
            }
            record.latest = dir.clone();
            record.current = Some(dir.clone());
            // The user's choice (installed, active, stopped) is kept; the bytes were just
            // re-synced from the folder, so earlier damage is healed.
            if record.state == "altered" {
                record.state = "installed".into();
            }
        }
    }
    let new_version = before.as_ref().is_none_or(|record| !record.versions.iter().any(|v| v.dir == dir));
    let changed = !reused || before.as_ref() != reg.plugins.get(&manifest.id);
    if new_version || !reused {
        registry::audit(root, "local_synced", &manifest.id, &format!("{} {}", manifest.version, short(&fingerprint)));
    }
    Ok(LocalPackage { folder: folder.to_string(), id: manifest.id.clone(), version: manifest.version.clone(), fingerprint, changed })
}

/// Removes records the current build no longer supports or whose folder is gone. Failures are
/// reported per plugin and never stop the sync.
fn retire(root: &Path, reg: &mut Registry, ids: Vec<String>, event: &str, errors: &mut Vec<LocalError>) {
    for id in ids {
        if let Err(error) = registry::remove_locked(root, reg, &id, event) {
            errors.push(LocalError { folder: id, message: error });
        }
    }
}

/// Synchronizes the package folders of `plugins_dir` into the managed root under the registry lock.
pub fn sync(managed_root: &Path, plugins_dir: &Path) -> Result<SyncResult, String> {
    let info = fs::symlink_metadata(plugins_dir).map_err(|error| format!("Could not read the plugins folder: {error}"))?;
    safe_copy::reject_special(&info)?;
    if !info.is_dir() {
        return Err("The plugins folder is not a directory".into());
    }
    let _guard = registry::locked(managed_root)?;
    let mut reg = registry::load_registry(managed_root)?;
    registry::recover_locked(managed_root)?;
    let before = reg.clone();
    let mut result = SyncResult::default();

    let legacy: Vec<String> = reg
        .plugins
        .iter()
        .filter(|(_, record)| record.versions.iter().any(|v| v.source == LEGACY_SOURCE))
        .map(|(id, _)| id.clone())
        .collect();
    retire(managed_root, &mut reg, legacy, "bundled_retired", &mut result.errors);

    let mut candidates = scan(plugins_dir)?;
    let mut failed: HashSet<String> = HashSet::new();
    for (name, _) in candidates.drain(MAX_FOLDERS.min(candidates.len())..) {
        failed.insert(name.clone());
        result.errors.push(LocalError { folder: name, message: format!("Only the first {MAX_FOLDERS} package folders are used") });
    }

    let mut parsed: Vec<(String, Package)> = Vec::new();
    for (name, path) in candidates {
        match read_package(&path) {
            Ok(package) => parsed.push((name, package)),
            Err(message) => {
                failed.insert(name.clone());
                result.errors.push(LocalError { folder: name, message });
            }
        }
    }
    let declared: HashSet<String> = parsed.iter().map(|(_, package)| package.manifest.id.clone()).collect();

    let mut by_id: BTreeMap<String, usize> = BTreeMap::new();
    for (_, package) in &parsed {
        *by_id.entry(package.manifest.id.clone()).or_default() += 1;
    }
    let mut valid = Vec::new();
    for (name, package) in parsed {
        if by_id[&package.manifest.id] > 1 {
            failed.insert(name.clone());
            result.errors.push(LocalError { folder: name, message: format!("Another folder declares the same plugin id '{}'", package.manifest.id) });
        } else {
            valid.push((name, package));
        }
    }

    for (index, (name, package)) in valid.iter().enumerate() {
        match publish_one(managed_root, &mut reg, name, package, index) {
            Ok(done) => result.packages.push(done),
            Err(message) => result.errors.push(LocalError { folder: name.clone(), message }),
        }
    }

    // A local record whose folder no longer provides its id is removed; a folder that is merely
    // broken right now keeps its last validated copy.
    let stale: Vec<String> = reg
        .plugins
        .iter()
        .filter(|(id, record)| {
            registry::latest_source(record) == Some(LOCAL_SOURCE)
                && !declared.contains(*id)
                && !record
                    .versions
                    .iter()
                    .find(|v| v.dir == record.latest)
                    .and_then(|v| v.local_folder.as_ref())
                    .is_some_and(|folder| failed.contains(folder))
        })
        .map(|(id, _)| id.clone())
        .collect();
    retire(managed_root, &mut reg, stale, "local_removed", &mut result.errors);

    // An unchanged registry is never rewritten, so a repeated sync is a no-op on disk.
    if reg != before {
        registry::save_registry(managed_root, &reg)?;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::Cursor, time::Duration};
    use zip::{write::SimpleFileOptions, ZipWriter};

    struct Scratch(PathBuf);
    impl Scratch {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir().join(format!("grimoire-plugin-local-{tag}-{}-{}", std::process::id(), registry::nonce()));
            fs::create_dir_all(path.join("Plugins")).unwrap();
            Scratch(path)
        }
        fn root(&self) -> PathBuf {
            self.0.join("managed")
        }
        fn plugins(&self) -> PathBuf {
            self.0.join("Plugins")
        }
        fn sync(&self) -> SyncResult {
            sync(&self.root(), &self.plugins()).unwrap()
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn manifest(id: &str, version: &str) -> String {
        format!(r#"{{"schemaVersion":1,"sdkVersion":1,"id":"{id}","name":"Zoom","version":"{version}","author":"A","description":"D","main":"dist/index.js","permissions":["editor:zoom:write","editor:zoom:read"]}}"#)
    }

    fn folder(scratch: &Scratch, name: &str, id: &str, version: &str, code: &str) -> PathBuf {
        let path = scratch.plugins().join(name);
        fs::create_dir_all(path.join("dist")).unwrap();
        fs::write(path.join("manifest.json"), manifest(id, version)).unwrap();
        fs::write(path.join("dist/index.js"), code).unwrap();
        path
    }

    fn record(scratch: &Scratch, id: &str) -> PluginRecord {
        registry::load_registry(&scratch.root()).unwrap().plugins.remove(id).unwrap()
    }

    fn registry_bytes(scratch: &Scratch) -> Vec<u8> {
        fs::read(scratch.root().join("registry.json")).unwrap()
    }

    #[test]
    fn the_first_sync_publishes_and_registers_an_approved_installed_record() {
        let scratch = Scratch::new("first");
        folder(&scratch, "zoom", "community.zoom", "1.0.0", "// v1");
        let result = scratch.sync();
        assert!(result.errors.is_empty(), "{:?}", result.errors);
        assert_eq!(result.packages.len(), 1);
        let package = &result.packages[0];
        assert_eq!((package.folder.as_str(), package.id.as_str(), package.version.as_str(), package.changed), ("zoom", "community.zoom", "1.0.0", true));
        let rec = record(&scratch, "community.zoom");
        assert_eq!((rec.state.as_str(), rec.current.as_deref()), ("installed", Some(rec.latest.as_str())));
        let version = &rec.versions[0];
        assert_eq!((version.source.as_str(), version.local_folder.as_deref()), ("local", Some("zoom")));
        assert_eq!(version.granted, vec!["editor:zoom:read".to_string(), "editor:zoom:write".to_string()]);
        assert!(version.consent_at.is_some());
        assert_eq!(fs::read_to_string(scratch.root().join("community.zoom").join(&rec.latest).join("dist/index.js")).unwrap(), "// v1");
        assert!(fs::read_to_string(scratch.root().join("audit.log")).unwrap().contains("local_synced"));
        assert!(fs::read_dir(scratch.root()).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().starts_with(registry::STAGING_PREFIX)));
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["packages"][0]["folder"], "zoom");
        assert!(json["errors"].as_array().unwrap().is_empty());
    }

    #[test]
    fn a_second_identical_sync_changes_nothing() {
        let scratch = Scratch::new("idem");
        folder(&scratch, "zoom", "community.zoom", "1.0.0", "x");
        scratch.sync();
        let before = registry_bytes(&scratch);
        let again = scratch.sync();
        assert!(!again.packages[0].changed);
        assert_eq!(registry_bytes(&scratch), before);
    }

    #[test]
    fn editing_the_code_publishes_a_new_version_keeps_old_ones_and_the_active_state() {
        let scratch = Scratch::new("edit");
        let path = folder(&scratch, "zoom", "community.zoom", "1.0.0", "old");
        scratch.sync();
        registry::set_active(&scratch.root(), "community.zoom", true).unwrap();
        let old = record(&scratch, "community.zoom").latest;
        fs::write(path.join("dist/index.js"), "new").unwrap();
        let result = scratch.sync();
        assert!(result.packages[0].changed);
        let rec = record(&scratch, "community.zoom");
        assert_ne!(rec.latest, old);
        assert_eq!((rec.state.as_str(), rec.current.as_deref(), rec.versions.len()), ("active", Some(rec.latest.as_str()), 2));
        assert_eq!(fs::read_to_string(scratch.root().join("community.zoom").join(&old).join("dist/index.js")).unwrap(), "old");
        assert_eq!(registry::read_entry(&scratch.root(), "community.zoom").unwrap().source, "new");
        // An unchanged follow-up leaves an active plugin active.
        assert!(!scratch.sync().packages[0].changed);
        assert_eq!(record(&scratch, "community.zoom").state, "active");
    }

    #[test]
    fn an_altered_record_is_healed_from_the_folder() {
        let scratch = Scratch::new("heal");
        folder(&scratch, "zoom", "community.zoom", "1.0.0", "safe");
        scratch.sync();
        let dir = record(&scratch, "community.zoom").latest;
        let copy = scratch.root().join("community.zoom").join(&dir).join("dist/index.js");
        fs::write(&copy, "evil").unwrap();
        assert_eq!(registry::list(&scratch.root()).unwrap().plugins["community.zoom"].state, "altered");
        let result = scratch.sync();
        assert!(result.errors.is_empty(), "{:?}", result.errors);
        assert!(result.packages[0].changed);
        let rec = record(&scratch, "community.zoom");
        assert_eq!((rec.state.as_str(), rec.current.as_deref()), ("installed", Some(dir.as_str())));
        assert_eq!(fs::read_to_string(&copy).unwrap(), "safe");
    }

    fn assert_rejected(scratch: &Scratch, name: &str) {
        let before = registry_bytes(scratch);
        let result = scratch.sync();
        assert!(result.errors.iter().any(|e| e.folder == name), "{name}: {:?}", result.errors);
        assert!(result.packages.iter().all(|p| p.folder != name));
        assert_eq!(registry_bytes(scratch), before, "a rejected folder leaves the registry untouched");
    }

    #[test]
    fn hostile_folders_fail_alone_and_leave_the_others_and_the_registry_untouched() {
        let scratch = Scratch::new("hostile");
        folder(&scratch, "good", "community.good", "1.0.0", "ok");
        scratch.sync();
        let good_before = registry_bytes(&scratch);

        let long = scratch.plugins().join("long-name");
        fs::create_dir_all(long.join("dist").join("a".repeat(101))).unwrap();
        fs::write(long.join("manifest.json"), manifest("community.long", "1.0.0")).unwrap();
        fs::write(long.join("dist/index.js"), "x").unwrap();

        let deep = folder(&scratch, "deep", "community.deep", "1.0.0", "x");
        let nested = deep.join("dist/a/b/c/d/e/f/g");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("x.js"), "x").unwrap();

        let big = folder(&scratch, "big", "community.big", "1.0.0", "x");
        fs::write(big.join("dist/huge.bin"), vec![0u8; package::MAX_FILE_BYTES as usize + 1]).unwrap();

        let no_entry = folder(&scratch, "no-entry", "community.noentry", "1.0.0", "x");
        fs::remove_file(no_entry.join("dist/index.js")).unwrap();

        let bad = folder(&scratch, "bad-json", "community.bad", "1.0.0", "x");
        fs::write(bad.join("manifest.json"), "{ nope").unwrap();

        let perm = folder(&scratch, "bad-perm", "community.perm", "1.0.0", "x");
        fs::write(perm.join("manifest.json"), manifest("community.perm", "1.0.0").replace("editor:zoom:read", "fs:read")).unwrap();

        let no_dist = folder(&scratch, "no-dist", "community.nodist", "1.0.0", "x");
        fs::remove_dir_all(no_dist.join("dist")).unwrap();

        let result = scratch.sync();
        for name in ["long-name", "deep", "big", "no-entry", "bad-json", "bad-perm", "no-dist"] {
            assert!(result.errors.iter().any(|e| e.folder == name), "{name} should fail: {:?}", result.errors);
        }
        assert_eq!(result.packages.len(), 1);
        assert_eq!(result.packages[0].folder, "good");
        assert!(!result.packages[0].changed);
        assert_eq!(registry_bytes(&scratch), good_before);
        let managed: Vec<String> = fs::read_dir(scratch.root()).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        assert!(managed.iter().all(|n| !n.starts_with(registry::STAGING_PREFIX) && !n.starts_with("community.long")), "{managed:?}");
    }

    #[cfg(any(unix, windows))]
    fn link_file(target: &Path, link: &Path) -> bool {
        #[cfg(unix)]
        return std::os::unix::fs::symlink(target, link).is_ok();
        #[cfg(windows)]
        return std::os::windows::fs::symlink_file(target, link).is_ok();
    }

    #[test]
    fn links_inside_dist_or_as_the_manifest_reject_that_folder_only() {
        let scratch = Scratch::new("links");
        folder(&scratch, "good", "community.good", "1.0.0", "ok");
        let outside = scratch.0.join("secret.txt");
        fs::write(&outside, "secret").unwrap();

        let inner = folder(&scratch, "inner-link", "community.inner", "1.0.0", "x");
        let linked = link_file(&outside, &inner.join("dist/leak.js"));
        let manifest_link = folder(&scratch, "manifest-link", "community.mlink", "1.0.0", "x");
        fs::remove_file(manifest_link.join("manifest.json")).unwrap();
        let manifest_linked = link_file(&outside, &manifest_link.join("manifest.json"));
        if !linked && !manifest_linked {
            return; // this platform or user cannot create links
        }
        let result = scratch.sync();
        assert!(result.packages.iter().any(|p| p.folder == "good"));
        if linked {
            assert!(result.errors.iter().any(|e| e.folder == "inner-link"), "{:?}", result.errors);
        }
        if manifest_linked {
            assert!(result.errors.iter().any(|e| e.folder == "manifest-link"), "{:?}", result.errors);
        }
        assert!(!scratch.root().join("community.inner").exists() && !scratch.root().join("community.mlink").exists());
    }

    #[test]
    fn names_that_differ_only_by_case_reject_the_folder() {
        let scratch = Scratch::new("case");
        let path = folder(&scratch, "cased", "community.cased", "1.0.0", "x");
        fs::write(path.join("dist/A.js"), "1").unwrap();
        fs::write(path.join("dist/a.js"), "2").unwrap();
        let both = fs::read_dir(path.join("dist")).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().to_lowercase() == "a.js").count();
        if both < 2 {
            return; // a case-insensitive file system cannot hold both names
        }
        assert_rejected(&scratch, "cased");
    }

    #[test]
    fn two_folders_with_the_same_id_both_fail() {
        let scratch = Scratch::new("dup");
        folder(&scratch, "one", "community.same", "1.0.0", "1");
        folder(&scratch, "two", "community.same", "1.0.0", "2");
        folder(&scratch, "other", "community.other", "1.0.0", "3");
        let result = scratch.sync();
        let names: Vec<&str> = result.errors.iter().map(|e| e.folder.as_str()).collect();
        assert_eq!(names.len(), 2);
        assert!(names.contains(&"one") && names.contains(&"two"));
        assert_eq!(result.packages.len(), 1);
        assert!(!registry::load_registry(&scratch.root()).unwrap().plugins.contains_key("community.same"));
    }

    #[test]
    fn extra_files_and_folders_without_a_manifest_are_ignored() {
        let scratch = Scratch::new("ignored");
        let path = folder(&scratch, "zoom", "community.zoom", "1.0.0", "x");
        fs::write(path.join("index.md"), "# docs").unwrap();
        fs::create_dir_all(path.join("legacy")).unwrap();
        fs::write(path.join("legacy/old.tsx"), "old").unwrap();
        fs::create_dir_all(scratch.plugins().join("bookmarks")).unwrap();
        fs::write(scratch.plugins().join("bookmarks/script.ts"), "x").unwrap();
        fs::write(scratch.plugins().join("loose.tsx"), "x").unwrap();
        fs::create_dir_all(scratch.plugins().join(".hidden/dist")).unwrap();
        fs::write(scratch.plugins().join(".hidden/manifest.json"), manifest("community.hidden", "1.0.0")).unwrap();
        let result = scratch.sync();
        assert!(result.errors.is_empty(), "{:?}", result.errors);
        assert_eq!(result.packages.len(), 1);
        let rec = record(&scratch, "community.zoom");
        let copy = scratch.root().join("community.zoom").join(&rec.latest);
        assert!(copy.join("manifest.json").is_file() && !copy.join("index.md").exists() && !copy.join("legacy").exists());
        // Editing an ignored file is not a change.
        fs::write(path.join("index.md"), "# more docs").unwrap();
        assert!(!scratch.sync().packages[0].changed);
    }

    #[test]
    fn deleting_the_folder_removes_the_record_and_its_files() {
        let scratch = Scratch::new("delete");
        let path = folder(&scratch, "zoom", "community.zoom", "1.0.0", "x");
        scratch.sync();
        assert!(scratch.root().join("community.zoom").is_dir());
        fs::remove_dir_all(path).unwrap();
        let result = scratch.sync();
        assert!(result.packages.is_empty() && result.errors.is_empty());
        assert!(!registry::load_registry(&scratch.root()).unwrap().plugins.contains_key("community.zoom"));
        assert!(!scratch.root().join("community.zoom").exists());
        assert!(fs::read_to_string(scratch.root().join("audit.log")).unwrap().contains("local_removed"));
    }

    #[test]
    fn a_broken_edit_keeps_the_last_validated_copy() {
        let scratch = Scratch::new("broken");
        let path = folder(&scratch, "zoom", "community.zoom", "1.0.0", "x");
        scratch.sync();
        fs::write(path.join("manifest.json"), "{ nope").unwrap();
        let result = scratch.sync();
        assert_eq!(result.errors.len(), 1);
        assert!(registry::load_registry(&scratch.root()).unwrap().plugins.contains_key("community.zoom"));
    }

    fn import_zip(scratch: &Scratch, id: &str) -> registry::InstallResult {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer.start_file("manifest.json", SimpleFileOptions::default()).unwrap();
        writer.write_all(manifest(id, "1.0.0").as_bytes()).unwrap();
        writer.start_file("dist/index.js", SimpleFileOptions::default()).unwrap();
        writer.write_all(b"imported").unwrap();
        let zip = scratch.0.join(format!("{id}.zip"));
        fs::write(&zip, writer.finish().unwrap().into_inner()).unwrap();
        registry::install(&scratch.root(), &zip, Duration::from_secs(30)).unwrap()
    }

    #[test]
    fn an_imported_plugin_is_never_overridden_by_a_folder() {
        let scratch = Scratch::new("import");
        import_zip(&scratch, "community.zoom");
        let before = registry_bytes(&scratch);
        folder(&scratch, "zoom", "community.zoom", "2.0.0", "folder");
        let result = scratch.sync();
        assert!(result.packages.is_empty());
        assert!(result.errors[0].message.contains("already used by an imported plugin"), "{:?}", result.errors);
        assert_eq!(registry_bytes(&scratch), before);
        assert!(scratch.root().join("community.zoom").is_dir());
        // And the import survives the folder disappearing.
        fs::remove_dir_all(scratch.plugins().join("zoom")).unwrap();
        scratch.sync();
        assert!(registry::load_registry(&scratch.root()).unwrap().plugins.contains_key("community.zoom"));
    }

    #[test]
    fn a_legacy_bundled_record_is_retired_at_every_sync() {
        let scratch = Scratch::new("legacy");
        import_zip(&scratch, "community.zoom");
        let mut reg = registry::load_registry(&scratch.root()).unwrap();
        let mut old = reg.plugins["community.zoom"].clone();
        old.versions[0].source = "bundled".into();
        reg.plugins.insert("builtin.zoom".into(), old);
        fs::create_dir_all(scratch.root().join("builtin.zoom/1.0.0-abc")).unwrap();
        registry::save_registry(&scratch.root(), &reg).unwrap();
        let result = scratch.sync();
        assert!(result.errors.is_empty(), "{:?}", result.errors);
        let after = registry::load_registry(&scratch.root()).unwrap();
        assert!(!after.plugins.contains_key("builtin.zoom") && after.plugins.contains_key("community.zoom"));
        assert!(!scratch.root().join("builtin.zoom").exists());
        assert!(fs::read_to_string(scratch.root().join("audit.log")).unwrap().contains("bundled_retired"));
    }

    #[test]
    fn local_folders_may_use_builtin_ids_but_imports_may_not() {
        let scratch = Scratch::new("builtin");
        folder(&scratch, "zoom", "builtin.zoom", "1.0.0", "x");
        let result = scratch.sync();
        assert!(result.errors.is_empty(), "{:?}", result.errors);
        registry::set_active(&scratch.root(), "builtin.zoom", true).unwrap();
        let payload = registry::read_entry(&scratch.root(), "builtin.zoom").unwrap();
        assert_eq!((payload.origin.as_str(), payload.source.as_str()), ("local", "x"));

        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer.start_file("manifest.json", SimpleFileOptions::default()).unwrap();
        writer.write_all(manifest("builtin.other", "1.0.0").as_bytes()).unwrap();
        writer.start_file("dist/index.js", SimpleFileOptions::default()).unwrap();
        writer.write_all(b"evil").unwrap();
        let zip = scratch.0.join("claim.zip");
        fs::write(&zip, writer.finish().unwrap().into_inner()).unwrap();
        assert!(registry::install(&scratch.root(), &zip, Duration::from_secs(30)).is_err());
    }

    #[test]
    fn the_kill_switch_leaves_local_plugins_running_and_still_stops_imports() {
        let scratch = Scratch::new("kill");
        folder(&scratch, "zoom", "builtin.zoom", "1.0.0", "x");
        scratch.sync();
        registry::set_active(&scratch.root(), "builtin.zoom", true).unwrap();
        let imported = import_zip(&scratch, "community.ruler");
        registry::grant_consent(&scratch.root(), "community.ruler", &imported.version, &imported.fingerprint, &imported.permissions, 1).unwrap();
        registry::set_active(&scratch.root(), "community.ruler", true).unwrap();

        registry::set_disabled_all(&scratch.root(), true).unwrap();
        let reg = registry::load_registry(&scratch.root()).unwrap();
        assert_eq!(reg.plugins["builtin.zoom"].state, "active");
        assert_eq!(reg.plugins["community.ruler"].state, "installed");
        assert!(registry::read_entry(&scratch.root(), "builtin.zoom").is_ok());
        assert!(registry::read_entry(&scratch.root(), "community.ruler").is_err());
        assert!(registry::set_active(&scratch.root(), "community.ruler", true).is_err());
        registry::set_active(&scratch.root(), "builtin.zoom", false).unwrap();
        registry::set_active(&scratch.root(), "builtin.zoom", true).unwrap();
    }

    #[test]
    fn the_renderer_cannot_remove_a_local_record() {
        let scratch = Scratch::new("remove");
        folder(&scratch, "zoom", "community.zoom", "1.0.0", "x");
        scratch.sync();
        let error = registry::remove(&scratch.root(), "community.zoom").unwrap_err();
        assert!(error.contains("Delete the folder instead"), "{error}");
        assert!(scratch.root().join("community.zoom").is_dir());
    }

    #[test]
    fn registries_without_local_folder_still_load_and_the_field_is_optional_on_disk() {
        let scratch = Scratch::new("compat");
        import_zip(&scratch, "community.zoom");
        let text = fs::read_to_string(scratch.root().join("registry.json")).unwrap();
        assert!(!text.contains("localFolder"), "imports do not write the field");
        assert!(registry::load_registry(&scratch.root()).unwrap().plugins["community.zoom"].versions[0].local_folder.is_none());
    }

    #[test]
    fn the_plugins_folder_cannot_be_the_managed_storage() {
        let scratch = Scratch::new("guard");
        assert!(ensure_outside_managed(&scratch.root(), &scratch.root()).is_err());
        assert!(ensure_outside_managed(&scratch.root(), &scratch.root().join("sub")).is_err());
        assert!(ensure_outside_managed(&scratch.root(), &scratch.plugins()).is_ok());
        assert!(sync(&scratch.root(), &scratch.0.join("missing")).is_err());
    }
}
