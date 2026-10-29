//! One prepared configuration root, independent of the application identifier.
use crate::portable::{self, Mode};
use crate::safe_copy::{copy_entries, inventory, lock_ancestors, open_checked};
use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_fs::FsExt;

const DIRECTORY: &str = "GriomoireMaker";
const MAX_PREFERENCES_BYTES: u64 = 16 * 1024 * 1024;
static PREPARATION: Mutex<()> = Mutex::new(());

struct PreparedRoot {
    path: PathBuf,
    mode: Mode,
    // Prevent replacement of the authoritative root while the application is running on Windows.
    _directory: File,
}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let _guard = PREPARATION.lock().map_err(|error| error.to_string())?;
    if app.try_state::<PreparedRoot>().is_some() {
        return Ok(());
    }
    // The mode is decided before anything asks Tauri for the per-user configuration directory.
    let (root, mode) = match portable_exe_dir() {
        Some(exe_dir) => (portable::prepare_data_dir(&exe_dir)?, Mode::Portable),
        None => {
            let old = app
                .path()
                .app_config_dir()
                .map_err(|error| error.to_string())?;
            (prepare_in(&old)?, Mode::Normal)
        }
    };
    portable::set_active(mode);
    let directory = open_checked(&root, true)?;
    app.fs_scope()
        .allow_directory(&root, true)
        .map_err(|error| error.to_string())?;
    crate::fs_scope::allow_owned_file(&app.fs_scope(), &root.join("Mods"), ".examples-seeded")?;
    if !app.manage(PreparedRoot {
        path: root,
        mode,
        _directory: directory,
    }) {
        return Err("Application configuration was already initialized".into());
    }
    Ok(())
}

/// The executable's folder when a regular `portable.flag` sits next to it, otherwise `None`.
pub fn portable_exe_dir() -> Option<PathBuf> {
    portable::exe_dir().filter(|dir| portable::detect(dir) == Mode::Portable)
}

/// How this run resolved its configuration root. `Normal` until `initialize` has run.
pub fn mode(app: &AppHandle) -> Mode {
    app.try_state::<PreparedRoot>()
        .map(|root| root.mode)
        .unwrap_or(Mode::Normal)
}

/// Whether `value` is `root` itself or lies under it (case-insensitive on Windows).
pub(crate) fn is_inside(value: &str, root: &Path) -> bool {
    rebased_path(value, root, root).is_some()
}

pub fn path(app: &AppHandle) -> Result<PathBuf, String> {
    app.try_state::<PreparedRoot>()
        .map(|root| root.path.clone())
        .ok_or_else(|| "Application configuration has not been prepared".into())
}

#[tauri::command]
pub fn config_root(app: AppHandle) -> Result<String, String> {
    path(&app)?
        .to_str()
        .map(|root| root.replace('\\', "/"))
        .ok_or_else(|| "Application configuration path is not valid Unicode".into())
}

fn prepare_in(old: &Path) -> Result<PathBuf, String> {
    prepare_with_publish(old, publish_no_replace)
}

fn prepare_with_publish(
    old: &Path,
    publish: impl FnOnce(&Path, &Path) -> Result<(), String>,
) -> Result<PathBuf, String> {
    let parent = old
        .parent()
        .ok_or("Configuration must have a parent directory")?;
    let new = parent.join(DIRECTORY);
    let mut parent_locks = Vec::new();
    lock_ancestors(parent, &mut parent_locks)?;
    match fs::symlink_metadata(&new) {
        Ok(_) => {
            open_checked(&new, true)?;
            return Ok(new);
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
        Err(error) => return Err(error.to_string()),
    }
    let mut source_locks = Vec::new();
    let mut entries = Vec::new();
    match fs::symlink_metadata(old) {
        Ok(_) => {
            lock_ancestors(old, &mut source_locks)?;
            inventory(old, Path::new(""), &mut entries, &mut source_locks)?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
        Err(error) => return Err(error.to_string()),
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let stage = parent.join(format!(
        ".{DIRECTORY}-migration-{}-{stamp}",
        std::process::id()
    ));
    fs::create_dir(&stage).map_err(|error| error.to_string())?;
    let result = (|| {
        let mut stage_locks = vec![open_checked(&stage, true)?];
        copy_entries(entries, &stage, &mut stage_locks, |relative, input| {
            rebase_preferences(relative, input, old, &new)
        })?;
        // Windows must release its own no-delete handles before the atomic directory rename.
        // Parent and old-tree handles remain held; no existing target is replaced.
        drop(stage_locks);
        publish(&stage, &new)?;
        open_checked(&new, true)?;
        Ok(new)
    })();
    result.map_err(|error: String| format!("Configuration migration failed: {error}. Original configuration was retained; inspect staging directory {} before retrying", stage.display()))
}

fn rebase_preferences(
    relative: &Path,
    input: &mut File,
    old: &Path,
    new: &Path,
) -> Result<Option<Vec<u8>>, String> {
    if relative != Path::new("setting.json") && relative != Path::new("library-paths.json") {
        return Ok(None);
    }
    if input.metadata().map_err(|error| error.to_string())?.len() > MAX_PREFERENCES_BYTES {
        return Err("Preferences exceed the migration size limit".into());
    }
    let mut bytes = Vec::new();
    input
        .take(MAX_PREFERENCES_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_PREFERENCES_BYTES {
        return Err("Preferences exceed the migration size limit".into());
    }
    let mut value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Invalid {}: {error}", relative.display()))?;
    let paths = if relative == Path::new("setting.json") {
        value.get_mut("paths")
    } else {
        Some(&mut value)
    };
    let mut changed = false;
    if let Some(paths) = paths.and_then(serde_json::Value::as_object_mut) {
        for key in ["plugins", "snippets", "templates", "themes", "logs"] {
            if let Some(value) = paths.get_mut(key) {
                if let Some(rebased) = value.as_str().and_then(|path| rebased_path(path, old, new))
                {
                    *value = serde_json::Value::String(rebased);
                    changed = true;
                }
            }
        }
    }
    if changed {
        bytes = serde_json::to_vec_pretty(&value).map_err(|error| error.to_string())?;
    }
    Ok(Some(bytes))
}

pub(crate) fn rebased_path(value: &str, old: &Path, new: &Path) -> Option<String> {
    fn normalized(value: &str) -> String {
        let value = value.replace('\\', "/");
        #[cfg(windows)]
        let value = value.strip_prefix("//?/").unwrap_or(&value).to_string();
        value.trim_end_matches('/').to_string()
    }
    let value = normalized(value);
    let old = normalized(old.to_str()?);
    let pieces: Vec<_> = value.split('/').collect();
    let prefix: Vec<_> = old.split('/').collect();
    if pieces.len() < prefix.len() || pieces.iter().any(|part| *part == "..") {
        return None;
    }
    for (actual, expected) in pieces.iter().zip(&prefix) {
        #[cfg(windows)]
        let equal = actual.eq_ignore_ascii_case(expected);
        #[cfg(not(windows))]
        let equal = actual == expected;
        if !equal {
            return None;
        }
    }
    let relative = pieces[prefix.len()..].join("/");
    let root = normalized(new.to_str()?);
    Some(if relative.is_empty() {
        root
    } else {
        format!("{root}/{relative}")
    })
}

#[cfg(windows)]
fn publish_no_replace(stage: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(existing: *const u16, destination: *const u16, flags: u32) -> i32;
    }
    let source: Vec<_> = stage.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<_> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    // SAFETY: both paths are valid null-terminated UTF-16 buffers for the call duration.
    // WRITE_THROUGH, deliberately WITHOUT REPLACE_EXISTING or COPY_ALLOWED.
    if unsafe { MoveFileExW(source.as_ptr(), target.as_ptr(), 0x8) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

#[cfg(any(
    target_os = "linux",
    target_os = "android",
    target_os = "macos",
    target_os = "ios"
))]
fn publish_no_replace(stage: &Path, destination: &Path) -> Result<(), String> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let source = CString::new(stage.as_os_str().as_bytes()).map_err(|error| error.to_string())?;
    let target =
        CString::new(destination.as_os_str().as_bytes()).map_err(|error| error.to_string())?;
    #[cfg(any(target_os = "linux", target_os = "android"))]
    let result = {
        unsafe extern "C" {
            fn renameat2(oldfd: i32, old: *const i8, newfd: i32, new: *const i8, flags: u32)
                -> i32;
        }
        // SAFETY: valid C strings; AT_FDCWD and RENAME_NOREPLACE prevent replacement.
        unsafe { renameat2(-100, source.as_ptr(), -100, target.as_ptr(), 1) }
    };
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    let result = {
        unsafe extern "C" {
            fn renamex_np(old: *const i8, new: *const i8, flags: u32) -> i32;
        }
        // SAFETY: valid C strings; RENAME_EXCL prevents replacement.
        unsafe { renamex_np(source.as_ptr(), target.as_ptr(), 0x4) }
    };
    if result != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

#[cfg(not(any(
    windows,
    target_os = "linux",
    target_os = "android",
    target_os = "macos",
    target_os = "ios"
)))]
fn publish_no_replace(_stage: &Path, _destination: &Path) -> Result<(), String> {
    Err("Atomic configuration migration is not supported on this platform".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };
    fn scratch(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "grimoire-config-root-{name}-{}-{stamp}",
            std::process::id()
        ));
        fs::create_dir(&root).unwrap();
        eprintln!("config root scratch retained: {}", root.display());
        root
    }
    #[test]
    fn config_root_fresh_uses_exact_requested_name_and_is_idempotent() {
        let parent = scratch("fresh");
        let old = parent.join("app.grimoiremaker.desktop");
        let expected = parent.join("GriomoireMaker");
        assert_eq!(prepare_in(&old).unwrap(), expected);
        assert!(expected.is_dir());
        assert!(!old.exists());
        assert_eq!(prepare_in(&old).unwrap(), expected);
    }
    #[test]
    fn config_root_migration_preserves_binary_hidden_empty_and_originals() {
        let parent = scratch("copy");
        let old = parent.join("app.grimoiremaker.desktop");
        fs::create_dir_all(old.join(".hidden/empty")).unwrap();
        fs::write(old.join(".hidden/data.bin"), [0, 255, 3, 7]).unwrap();
        let new = prepare_in(&old).unwrap();
        assert_ne!(new, old);
        assert_eq!(
            fs::read(new.join(".hidden/data.bin")).unwrap(),
            [0, 255, 3, 7]
        );
        assert!(new.join(".hidden/empty").is_dir());
        assert_eq!(
            fs::read(old.join(".hidden/data.bin")).unwrap(),
            [0, 255, 3, 7]
        );
    }
    #[test]
    fn config_root_existing_destination_is_authoritative_without_merging() {
        let parent = scratch("existing");
        let old = parent.join("app.grimoiremaker.desktop");
        let new = parent.join("GriomoireMaker");
        fs::create_dir(&old).unwrap();
        fs::create_dir(&new).unwrap();
        fs::write(old.join("old.txt"), "old").unwrap();
        fs::write(new.join("new.txt"), "new").unwrap();
        assert_eq!(prepare_in(&old).unwrap(), new);
        assert!(!new.join("old.txt").exists());
        assert_eq!(fs::read_to_string(new.join("new.txt")).unwrap(), "new");
    }
    #[test]
    fn config_root_rebases_only_internal_library_paths_and_retains_settings_and_session_bytes() {
        let parent = scratch("paths");
        let old = parent.join("app.grimoiremaker.desktop");
        fs::create_dir_all(old.join("Mods/Plugins")).unwrap();
        let external = parent.join("app.grimoiremaker.desktop-external/themes");
        let paths = serde_json::json!({
            "plugins": old.join("Mods/Plugins"), "snippets": old.join("Mods/Snippets"),
            "templates": old.join("Mods/Templates"), "themes": external, "logs": old.join("logs"),
        });
        let settings = serde_json::json!({ "theme": "custom", "zoom": 1.75, "rulerGuides": [] });
        let original = serde_json::to_vec(&serde_json::json!({ "paths": paths, "settings": settings, "future": { "keep": true } })).unwrap();
        fs::write(old.join("setting.json"), &original).unwrap();
        let legacy = serde_json::to_vec(&paths).unwrap();
        fs::write(old.join("library-paths.json"), &legacy).unwrap();
        let state = serde_json::to_vec(&serde_json::json!({ "lastWorkspace": old.join("project"), "recentWorkspaces": [old.join("project")] })).unwrap();
        fs::write(old.join("state.json"), &state).unwrap();
        let new = prepare_in(&old).unwrap();
        let actual: serde_json::Value =
            serde_json::from_slice(&fs::read(new.join("setting.json")).unwrap()).unwrap();
        let legacy_actual: serde_json::Value =
            serde_json::from_slice(&fs::read(new.join("library-paths.json")).unwrap()).unwrap();
        for (key, relative) in [
            ("plugins", "Mods/Plugins"),
            ("snippets", "Mods/Snippets"),
            ("templates", "Mods/Templates"),
            ("logs", "logs"),
        ] {
            let expected = new.join(relative).to_str().unwrap().replace('\\', "/");
            assert_eq!(actual["paths"][key], expected);
            assert_eq!(legacy_actual[key], expected);
        }
        assert_eq!(actual["paths"]["themes"], paths["themes"]);
        assert_eq!(actual["settings"], settings);
        assert_eq!(actual["future"]["keep"], true);
        assert_eq!(fs::read(new.join("state.json")).unwrap(), state);
        assert_eq!(fs::read(old.join("setting.json")).unwrap(), original);
        assert_eq!(fs::read(old.join("library-paths.json")).unwrap(), legacy);
        #[cfg(windows)]
        {
            let alias = format!(
                "//?/{}/logs",
                old.to_str().unwrap().replace('\\', "/").to_uppercase()
            );
            assert_eq!(
                rebased_path(&alias, &old, &new),
                Some(new.join("logs").to_str().unwrap().replace('\\', "/"))
            );
        }
    }
    #[test]
    fn config_root_invalid_preferences_keep_old_and_never_publish_partial_stage() {
        let parent = scratch("invalid");
        let old = parent.join("app.grimoiremaker.desktop");
        fs::create_dir(&old).unwrap();
        fs::write(old.join("setting.json"), "{broken").unwrap();
        fs::write(old.join("asset.bin"), [1, 2, 255]).unwrap();
        assert!(prepare_in(&old).unwrap_err().contains("migration failed"));
        assert!(!parent.join(DIRECTORY).exists());
        assert_eq!(
            fs::read_to_string(old.join("setting.json")).unwrap(),
            "{broken"
        );
        assert_eq!(fs::read(old.join("asset.bin")).unwrap(), [1, 2, 255]);
        assert_eq!(
            fs::read_dir(&parent)
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".GriomoireMaker-migration-"))
                .count(),
            1
        );
    }
    #[test]
    fn config_root_publish_failure_retains_stage_and_retry_never_merges_it() {
        let parent = scratch("partial");
        let old = parent.join("app.grimoiremaker.desktop");
        fs::create_dir(&old).unwrap();
        fs::write(old.join("keep.txt"), "original").unwrap();
        assert!(prepare_with_publish(&old, |stage, _| {
            assert_eq!(
                fs::read_to_string(stage.join("keep.txt")).unwrap(),
                "original"
            );
            Err("injected publication failure".into())
        })
        .is_err());
        assert!(!parent.join(DIRECTORY).exists());
        let new = prepare_in(&old).unwrap();
        assert_eq!(
            fs::read_to_string(new.join("keep.txt")).unwrap(),
            "original"
        );
        assert_eq!(
            fs::read_dir(&parent)
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".GriomoireMaker-migration-"))
                .count(),
            1
        );
    }
    #[test]
    fn config_root_publication_cannot_clobber_a_racing_destination() {
        let parent = scratch("collision");
        let old = parent.join("app.grimoiremaker.desktop");
        fs::create_dir(&old).unwrap();
        fs::write(old.join("old.txt"), "old").unwrap();
        assert!(prepare_with_publish(&old, |stage, destination| {
            fs::create_dir(destination).unwrap();
            // An empty competing directory must not be replaced either.
            let result = publish_no_replace(stage, destination);
            assert!(result.is_err());
            assert!(stage.join("old.txt").is_file());
            assert_eq!(fs::read_dir(destination).unwrap().count(), 0);
            result
        })
        .is_err());
        assert_eq!(fs::read_to_string(old.join("old.txt")).unwrap(), "old");
    }
    #[test]
    fn config_root_rejects_linked_source_contents_and_destination_root() {
        let parent = scratch("links");
        let old = parent.join("app.grimoiremaker.desktop");
        let outside = parent.join("outside");
        fs::create_dir(&old).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("secret.txt"), "private").unwrap();
        let link = old.join("linked");
        fn make_link(link: &Path, target: &Path) {
            #[cfg(windows)]
            assert!(std::process::Command::new("cmd")
                .args(["/c", "mklink", "/J"])
                .arg(link)
                .arg(target)
                .output()
                .unwrap()
                .status
                .success());
            #[cfg(unix)]
            std::os::unix::fs::symlink(target, link).unwrap();
        }
        make_link(&link, &outside);
        assert!(prepare_in(&old).is_err());
        assert!(!parent.join(DIRECTORY).exists());
        make_link(&parent.join(DIRECTORY), &outside);
        assert!(prepare_in(&old).is_err());
        assert_eq!(
            fs::read_to_string(outside.join("secret.txt")).unwrap(),
            "private"
        );
    }
}
