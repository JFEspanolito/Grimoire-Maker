//! First-party plugin packages embedded in the application binary.
//!
//! They are ordinary packages (manifest + entry) published into the managed root exactly like an
//! import, but recorded with `source = "bundled"` and pre-approved for exactly their declared
//! permissions. They still run isolated like any plugin. At every start the installed bytes are
//! compared with the embedded ones and repaired instead of being left `altered`.
use crate::plugin_registry::{self as registry, PluginRecord, VersionRecord, BUNDLED_SOURCE};
use crate::{plugin_install, plugin_package};
use std::{fs, path::Path};

/// One embedded package: the exact bytes of `manifest.json` and `dist/index.js`.
#[derive(Clone, Copy)]
pub struct Bundled {
    pub manifest: &'static str,
    pub entry: &'static str,
}

const PACKAGES: &[Bundled] = &[
    Bundled {
        manifest: include_str!("../../src/assets/mods/Packages/zoom/manifest.json"),
        entry: include_str!("../../src/assets/mods/Packages/zoom/dist/index.js"),
    },
    Bundled {
        manifest: include_str!("../../src/assets/mods/Packages/pixel-ruler/manifest.json"),
        entry: include_str!("../../src/assets/mods/Packages/pixel-ruler/dist/index.js"),
    },
];

/// Installs or repairs every embedded package under the managed root.
pub fn ensure(root: &Path) -> Result<(), String> {
    ensure_with(root, PACKAGES)
}

pub fn ensure_with(root: &Path, packages: &[Bundled]) -> Result<(), String> {
    let _guard = registry::locked(root)?;
    let mut reg = registry::load_registry(root)?;
    registry::recover_locked(root)?;
    let before = reg.clone();
    let mut errors = Vec::new();
    for package in packages {
        if let Err(error) = ensure_one(root, &mut reg, package) {
            errors.push(error);
        }
    }
    // An unchanged registry is never rewritten, so a repeated start is a no-op on disk.
    if reg != before {
        registry::save_registry(root, &reg)?;
    }
    if errors.is_empty() { Ok(()) } else { Err(errors.join("; ")) }
}

fn ensure_one(root: &Path, reg: &mut registry::Registry, package: &Bundled) -> Result<(), String> {
    let manifest = plugin_package::parse_manifest_for(package.manifest.as_bytes(), true)?;
    // Materialize the embedded bytes into a staging directory and fingerprint them.
    let staging = root.join(format!("{}bundled-{}-{}", registry::STAGING_PREFIX, std::process::id(), registry::nonce()));
    let built = materialize(&staging, package).and_then(|_| plugin_install::fingerprint_dir(&staging));
    let fingerprint = match built {
        Ok(value) => value,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
    };
    let dir = format!("{}-{}", manifest.version, &fingerprint[..12]);
    let plugin_dir = root.join(&manifest.id);
    let target = plugin_dir.join(&dir);

    let mut repaired = false;
    if target.exists() && plugin_install::fingerprint_dir(&target).as_deref() != Ok(fingerprint.as_str()) {
        // Safe: `target` is root/<id>/<dir> where id passed `validate_id_for` and dir is the
        // embedded version plus the fingerprint of embedded bytes; nothing comes from user input.
        // The directory is refused unless it is a plain directory, never a link.
        if !registry::plain_dir(&plugin_dir) || !registry::plain_dir(&target) {
            let _ = fs::remove_dir_all(&staging);
            return Err("A bundled plugin folder is not a plain directory".into());
        }
        if let Err(error) = fs::remove_dir_all(&target) {
            let _ = fs::remove_dir_all(&staging);
            return Err(format!("Could not repair a bundled plugin: {error}"));
        }
        repaired = true;
    }
    let existed = target.exists();
    if let Err(error) = registry::publish(&staging, &plugin_dir, &dir, &fingerprint) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    if repaired {
        registry::audit(root, "bundled_repaired", &manifest.id, &format!("{} {}", manifest.version, &fingerprint[..12]));
    }

    let version = VersionRecord {
        dir: dir.clone(),
        version: manifest.version.clone(),
        fingerprint: fingerprint.clone(),
        name: manifest.name.clone(),
        author: manifest.author.clone(),
        description: manifest.description.clone(),
        permissions: manifest.permissions.clone(),
        granted: manifest.permissions.clone(),
        sdk_version: manifest.sdk_version,
        consent_at: Some(registry::now()),
        installed_at: registry::now(),
        source: BUNDLED_SOURCE.into(),
        signature: None,
    };
    let is_new = match reg.plugins.get_mut(&manifest.id) {
        None => {
            reg.plugins.insert(
                manifest.id.clone(),
                PluginRecord { latest: dir.clone(), current: Some(dir.clone()), state: "active".into(), versions: vec![version] },
            );
            true
        }
        Some(record) => {
            let known = record.versions.iter().position(|v| v.dir == dir);
            let installed_now = known.is_none();
            match known {
                None => record.versions.push(version),
                Some(index) => {
                    // Keep the original timestamps; only restore what the approval must hold.
                    let entry = &mut record.versions[index];
                    if entry.source != BUNDLED_SOURCE || entry.granted != manifest.permissions || entry.consent_at.is_none() {
                        entry.source = BUNDLED_SOURCE.into();
                        entry.granted = manifest.permissions.clone();
                        entry.consent_at = entry.consent_at.or(Some(registry::now()));
                    }
                }
            }
            record.latest = dir.clone();
            record.current = Some(dir.clone());
            // The user's choice (installed, active, stopped) is preserved; damage self-heals.
            if record.state == "altered" {
                record.state = "active".into();
            }
            installed_now
        }
    };
    if is_new && !existed {
        registry::audit(root, "bundled_installed", &manifest.id, &format!("{} {}", manifest.version, &fingerprint[..12]));
    } else if is_new {
        registry::audit(root, "bundled_installed", &manifest.id, &format!("{} {} (files reused)", manifest.version, &fingerprint[..12]));
    }
    Ok(())
}

fn materialize(staging: &Path, package: &Bundled) -> Result<(), String> {
    fs::create_dir_all(staging.join("dist")).map_err(|error| error.to_string())?;
    fs::write(staging.join(plugin_package::MANIFEST_ENTRY), package.manifest).map_err(|error| error.to_string())?;
    fs::write(staging.join(plugin_package::MAIN_ENTRY), package.entry).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{path::PathBuf, time::Duration};

    struct Scratch(PathBuf);
    impl Scratch {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir().join(format!("grimoire-plugin-bundled-{tag}-{}-{}", std::process::id(), registry::nonce()));
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

    const ID: &str = "builtin.zoom";
    const V1: Bundled = Bundled {
        manifest: r#"{"schemaVersion":1,"sdkVersion":1,"id":"builtin.zoom","name":"Zoom","version":"1.0.0","author":"G","description":"D","main":"dist/index.js","permissions":["editor:zoom:read"]}"#,
        entry: "// v1",
    };
    const V2: Bundled = Bundled {
        manifest: r#"{"schemaVersion":1,"sdkVersion":1,"id":"builtin.zoom","name":"Zoom","version":"2.0.0","author":"G","description":"D","main":"dist/index.js","permissions":["editor:zoom:read"]}"#,
        entry: "// v2",
    };

    fn record(root: &Path) -> PluginRecord {
        registry::load_registry(root).unwrap().plugins.remove(ID).unwrap()
    }

    fn entry_file(root: &Path, record: &PluginRecord) -> PathBuf {
        root.join(ID).join(&record.latest).join("dist/index.js")
    }

    #[test]
    fn a_new_bundled_package_is_installed_pre_approved_and_active() {
        let scratch = Scratch::new("new");
        let root = scratch.root();
        ensure_with(&root, &[V1]).unwrap();
        let rec = record(&root);
        assert_eq!((rec.state.as_str(), rec.current.as_deref()), ("active", Some(rec.latest.as_str())));
        let version = &rec.versions[0];
        assert_eq!(version.source, "bundled");
        assert_eq!(version.granted, version.permissions);
        assert_eq!(version.permissions, vec!["editor:zoom:read".to_string()]);
        assert!(version.consent_at.is_some());
        assert_eq!(fs::read_to_string(entry_file(&root, &rec)).unwrap(), "// v1");
        assert!(fs::read_to_string(root.join("audit.log")).unwrap().contains("bundled_installed"));
        let payload = registry::read_entry(&root, ID).unwrap();
        assert_eq!((payload.origin.as_str(), payload.source.as_str()), ("bundled", "// v1"));
        assert!(fs::read_dir(&root).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().starts_with(registry::STAGING_PREFIX)));
    }

    #[test]
    fn ensure_is_idempotent_and_leaves_the_registry_bytes_alone() {
        let scratch = Scratch::new("idem");
        let root = scratch.root();
        ensure_with(&root, &[V1]).unwrap();
        let before = fs::read(root.join("registry.json")).unwrap();
        ensure_with(&root, &[V1]).unwrap();
        assert_eq!(fs::read(root.join("registry.json")).unwrap(), before);
        assert_eq!(record(&root).versions.len(), 1);
    }

    #[test]
    fn the_embedded_packages_are_valid_and_install_cleanly() {
        let scratch = Scratch::new("real");
        let root = scratch.root();
        ensure(&root).unwrap();
        let reg = registry::load_registry(&root).unwrap();
        assert!(reg.plugins.contains_key("builtin.zoom") && reg.plugins.contains_key("builtin.pixel-ruler"));
        for id in ["builtin.zoom", "builtin.pixel-ruler"] {
            let payload = registry::read_entry(&root, id).unwrap();
            assert_eq!(payload.origin, "bundled");
            assert_eq!(payload.permissions.len(), reg.plugins[id].versions[0].permissions.len());
        }
        assert_eq!(registry::read_entry(&root, "builtin.zoom").unwrap().behaviors.len(), 1);
    }

    #[test]
    fn the_users_choice_survives_a_later_ensure() {
        let scratch = Scratch::new("choice");
        let root = scratch.root();
        ensure_with(&root, &[V1]).unwrap();
        registry::set_active(&root, ID, false).unwrap();
        ensure_with(&root, &[V1]).unwrap();
        assert_eq!(record(&root).state, "installed", "a deactivated bundled plugin stays deactivated");
        registry::set_active(&root, ID, true).unwrap();
        registry::mark_stopped(&root, ID, "watchdog").unwrap();
        ensure_with(&root, &[V1]).unwrap();
        assert_eq!(record(&root).state, "stopped");
    }

    #[test]
    fn a_new_embedded_version_replaces_current_and_keeps_old_directories_and_state() {
        let scratch = Scratch::new("upgrade");
        let root = scratch.root();
        ensure_with(&root, &[V1]).unwrap();
        let old = record(&root).latest;
        registry::set_active(&root, ID, false).unwrap();
        ensure_with(&root, &[V2]).unwrap();
        let rec = record(&root);
        assert_ne!(rec.latest, old);
        assert_eq!((rec.current.as_deref(), rec.state.as_str()), (Some(rec.latest.as_str()), "installed"));
        assert_eq!(rec.versions.len(), 2);
        assert!(root.join(ID).join(&old).is_dir(), "older version directories are kept");
    }

    #[test]
    fn tampering_is_flagged_by_list_and_repaired_by_the_next_ensure() {
        let scratch = Scratch::new("tamper");
        let root = scratch.root();
        ensure_with(&root, &[V1]).unwrap();
        let rec = record(&root);
        let file = entry_file(&root, &rec);
        fs::write(&file, "evil").unwrap();
        fs::write(file.with_file_name("extra.js"), "x").unwrap();

        let listed = registry::list(&root).unwrap();
        assert_eq!((listed.plugins[ID].state.as_str(), listed.plugins[ID].current.clone()), ("altered", None));
        assert!(registry::read_entry(&root, ID).is_err());

        ensure_with(&root, &[V1]).unwrap();
        let healed = record(&root);
        assert_eq!((healed.state.as_str(), healed.current.as_deref()), ("active", Some(healed.latest.as_str())));
        assert_eq!(fs::read_to_string(&file).unwrap(), "// v1");
        assert!(!file.with_file_name("extra.js").exists());
        assert_eq!(registry::read_entry(&root, ID).unwrap().source, "// v1");
        assert!(fs::read_to_string(root.join("audit.log")).unwrap().contains("bundled_repaired"));
    }

    #[test]
    fn bundled_plugins_ignore_the_kill_switch_but_imported_ones_do_not() {
        let scratch = Scratch::new("kill");
        let root = scratch.root();
        ensure_with(&root, &[V1]).unwrap();
        // An imported plugin, approved and active.
        let zip_path = scratch.0.join("imp.zip");
        {
            use std::io::{Cursor, Write};
            use zip::{write::SimpleFileOptions, ZipWriter};
            let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
            writer.start_file("manifest.json", SimpleFileOptions::default()).unwrap();
            writer.write_all(br#"{"schemaVersion":1,"sdkVersion":1,"id":"community.zoom","name":"Z","version":"1.0.0","author":"A","description":"D","main":"dist/index.js","permissions":["editor:zoom:read"]}"#).unwrap();
            writer.start_file("dist/index.js", SimpleFileOptions::default()).unwrap();
            writer.write_all(b"x").unwrap();
            fs::write(&zip_path, writer.finish().unwrap().into_inner()).unwrap();
        }
        let installed = registry::install(&root, &zip_path, Duration::from_secs(30)).unwrap();
        registry::grant_consent(&root, "community.zoom", &installed.version, &installed.fingerprint, &["editor:zoom:read".to_string()], 1).unwrap();
        registry::set_active(&root, "community.zoom", true).unwrap();

        registry::set_disabled_all(&root, true).unwrap();
        let reg = registry::load_registry(&root).unwrap();
        assert_eq!(reg.plugins[ID].state, "active", "bundled keeps running");
        assert_eq!(reg.plugins["community.zoom"].state, "installed", "imported is stopped");
        assert!(registry::read_entry(&root, ID).is_ok());
        assert!(registry::read_entry(&root, "community.zoom").is_err());
        assert!(registry::set_active(&root, "community.zoom", true).is_err());
        registry::set_active(&root, ID, false).unwrap();
        registry::set_active(&root, ID, true).unwrap();
        assert!(registry::read_entry(&root, ID).is_ok());
    }

    #[test]
    fn bundled_plugins_cannot_be_removed_and_imports_cannot_claim_builtin_ids() {
        let scratch = Scratch::new("remove");
        let root = scratch.root();
        ensure_with(&root, &[V1]).unwrap();
        let error = registry::remove(&root, ID).unwrap_err();
        assert!(error.contains("Bundled plugins cannot be removed"), "{error}");
        assert!(root.join(ID).is_dir() && registry::load_registry(&root).unwrap().plugins.contains_key(ID));

        let zip_path = scratch.0.join("claim.zip");
        {
            use std::io::{Cursor, Write};
            use zip::{write::SimpleFileOptions, ZipWriter};
            let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
            writer.start_file("manifest.json", SimpleFileOptions::default()).unwrap();
            writer.write_all(V2.manifest.as_bytes()).unwrap();
            writer.start_file("dist/index.js", SimpleFileOptions::default()).unwrap();
            writer.write_all(b"evil").unwrap();
            fs::write(&zip_path, writer.finish().unwrap().into_inner()).unwrap();
        }
        assert!(registry::install(&root, &zip_path, Duration::from_secs(30)).is_err());
        assert_eq!(record(&root).versions.len(), 1, "a rejected import changes nothing");
    }
}
