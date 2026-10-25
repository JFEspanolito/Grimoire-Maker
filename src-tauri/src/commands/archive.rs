//! Bounded project ZIPs. Paths are obtained by native dialogs, never by renderer arguments.
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

const MAX_ENTRIES: usize = 10_000;
const MAX_FILE: u64 = 256 * 1024 * 1024;
const MAX_TOTAL: u64 = 1024 * 1024 * 1024;
const MAX_ARCHIVE: u64 = MAX_TOTAL + 16 * 1024 * 1024;
static BUSY: AtomicBool = AtomicBool::new(false);
static NEXT: AtomicU64 = AtomicU64::new(0);

struct Operation;
impl Operation {
    fn start() -> Result<Self, String> {
        BUSY.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "Another project archive operation is running")?;
        Ok(Self)
    }
}
impl Drop for Operation {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::Release);
    }
}

fn normalize(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_string()
}

fn active_root(state_path: &Path) -> Result<PathBuf, String> {
    let raw = fs::read(state_path).map_err(|e| e.to_string())?;
    let state: Value = serde_json::from_slice(&raw).map_err(|e| e.to_string())?;
    let root = state["lastWorkspace"].as_str().ok_or("No active project")?;
    if !state["recentWorkspaces"].as_array().is_some_and(|list| {
        list.iter()
            .filter_map(Value::as_str)
            .any(|p| normalize(p) == normalize(root))
    }) {
        return Err("Project is not the active remembered workspace".into());
    }
    let metadata = fs::symlink_metadata(root).map_err(|e| e.to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("Project must be a regular directory".into());
    }
    fs::canonicalize(root).map_err(|e| e.to_string())
}

fn excluded(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name == ".git"
        || name.starts_with(".grimoire-import-")
        || name.starts_with(".grimoire-archive-")
        || name.starts_with(".import-")
        || name.starts_with(".archive-")
        || (name.starts_with('.')
            && (name.ends_with(".tmp") || name.ends_with(".part") || name.contains(".tmp-")))
}

fn safe_component(name: &str) -> bool {
    let stem = name
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end_matches(' ')
        .to_uppercase();
    let reserved = matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) || (stem.starts_with("COM") || stem.starts_with("LPT"))
        && matches!(
            &stem[3..],
            "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
        );
    !name.is_empty()
        && name.len() <= 255
        && name != "."
        && name != ".."
        && !name.ends_with(['.', ' '])
        && !reserved
        && !excluded(name)
        && !name
            .chars()
            .any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
}

fn safe_name(name: &str) -> Result<String, String> {
    let name = name.strip_suffix('/').unwrap_or(name);
    if name.len() > 1024 || name.split('/').count() > 32 || !name.split('/').all(safe_component) {
        return Err(format!("Unsafe or unsupported archive path: {name}"));
    }
    Ok(name.to_string())
}

#[derive(Default)]
struct Names {
    explicit: HashSet<String>,
    paths: HashMap<String, (String, bool)>,
}
impl Names {
    fn add(&mut self, name: &str, directory: bool) -> Result<(), String> {
        if !self.explicit.insert(name.to_lowercase()) {
            return Err("Duplicate archive entry".into());
        }
        let parts: Vec<_> = name.split('/').collect();
        for end in 1..=parts.len() {
            let path = parts[..end].join("/");
            let is_dir = end != parts.len() || directory;
            let key = path.to_lowercase();
            if let Some((spelling, previous_dir)) = self.paths.get(&key) {
                if spelling != &path || *previous_dir != is_dir {
                    return Err("Case collision or file/directory conflict in archive".into());
                }
            } else {
                self.paths.insert(key, (path, is_dir));
            }
        }
        Ok(())
    }
}

fn pack_into(root: &Path, destination: &Path) -> Result<(), String> {
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let parent = fs::canonicalize(destination.parent().ok_or("Missing destination folder")?)
        .map_err(|e| e.to_string())?;
    if parent.starts_with(&root) {
        return Err("Save the archive outside the project folder".into());
    }
    if !destination
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
    {
        return Err("Archive filename must end in .zip".into());
    }
    if fs::symlink_metadata(destination).is_ok() {
        return Err("Destination already exists; choose a new filename".into());
    }
    let mut pending = vec![root.clone()];
    let mut entries = Vec::new();
    let mut names = Names::default();
    let mut total = 0u64;
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| "Project names must be valid UTF-8")?;
            if excluded(&name) {
                continue;
            }
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
            if metadata.file_type().is_symlink() {
                continue;
            }
            if !metadata.is_dir() && !metadata.is_file() {
                return Err("Project contains an unsupported special file".into());
            }
            let relative = path
                .strip_prefix(&root)
                .map_err(|e| e.to_string())?
                .to_str()
                .ok_or("Invalid project path")?
                .replace('\\', "/");
            let name = safe_name(&relative)?;
            names.add(&name, metadata.is_dir())?;
            if entries.len() == MAX_ENTRIES {
                return Err("Project exceeds 10,000 entries".into());
            }
            if metadata.is_dir() {
                pending.push(path.clone());
            } else {
                total = total
                    .checked_add(metadata.len())
                    .ok_or("Project is too large")?;
                if metadata.len() > MAX_FILE || total > MAX_TOTAL {
                    return Err("Project exceeds archive size limits".into());
                }
            }
            entries.push((name, path, metadata.is_dir(), metadata.len()));
        }
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    let staging = parent.join(format!(
        ".archive-{}-{}.tmp",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&staging)
        .map_err(|e| e.to_string())?;
    let result = (|| -> Result<(), String> {
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for (name, path, directory, size) in entries {
            if directory {
                zip.add_directory(format!("{name}/"), options)
                    .map_err(|e| e.to_string())?;
            } else {
                if fs::symlink_metadata(&path)
                    .map_err(|e| e.to_string())?
                    .file_type()
                    .is_symlink()
                    || !fs::canonicalize(&path)
                        .map_err(|e| e.to_string())?
                        .starts_with(&root)
                {
                    return Err("Project file changed into a link during packing".into());
                }
                let mut source = File::open(path).map_err(|e| e.to_string())?.take(size + 1);
                zip.start_file(name, options).map_err(|e| e.to_string())?;
                let copied = io::copy(&mut source, &mut zip).map_err(|e| e.to_string())?;
                if copied != size {
                    return Err("Project file changed during packing; save and try again".into());
                }
            }
        }
        let file = zip.finish().map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        if file.metadata().map_err(|e| e.to_string())?.len() > MAX_ARCHIVE {
            return Err("Archive is too large".into());
        }
        drop(file);
        // Atomic no-replace publication; unlike rename, hard_link cannot replace an existing file.
        fs::hard_link(&staging, destination)
            .map_err(|e| format!("Could not publish new archive: {e}"))
    })();
    let cleanup = fs::remove_file(&staging);
    if let Err(error) = cleanup {
        return Err(format!(
            "Archive result: {result:?}; temporary file cleanup failed: {error}"
        ));
    }
    result
}

/// Bound central-directory allocation before the ZIP library parses attacker-controlled metadata.
fn preflight(file: &mut File) -> Result<(), String> {
    let length = file.metadata().map_err(|e| e.to_string())?.len();
    if !(22..=MAX_ARCHIVE).contains(&length) {
        return Err("Archive exceeds size limits or is empty".into());
    }
    let tail_length = length.min(65_557) as usize;
    file.seek(SeekFrom::End(-(tail_length as i64)))
        .map_err(|e| e.to_string())?;
    let mut tail = vec![0; tail_length];
    file.read_exact(&mut tail).map_err(|e| e.to_string())?;
    let end = (0..=tail_length - 22)
        .rev()
        .find(|&i| {
            tail[i..i + 4] == *b"PK\x05\x06"
                && i + 22 + u16::from_le_bytes([tail[i + 20], tail[i + 21]]) as usize == tail_length
        })
        .ok_or("Missing ZIP end record")?;
    let u16_at = |n| u16::from_le_bytes([tail[end + n], tail[end + n + 1]]);
    let u32_at = |n| u32::from_le_bytes(tail[end + n..end + n + 4].try_into().unwrap()) as u64;
    if u16_at(4) != 0
        || u16_at(6) != 0
        || u16_at(8) != u16_at(10)
        || usize::from(u16_at(10)) > MAX_ENTRIES
        || u32_at(12) > 16 * 1024 * 1024
        || u32_at(16) + u32_at(12) != length - tail_length as u64 + end as u64
        || (end >= 20 && tail[end - 20..end - 16] == *b"PK\x06\x07")
    {
        return Err("Unsupported ZIP64, split archive, or archive metadata limits exceeded".into());
    }
    file.rewind().map_err(|e| e.to_string())?;
    Ok(())
}

fn restore_into(archive: &Path, destination: &Path) -> Result<(), String> {
    if !destination
        .file_name()
        .and_then(|v| v.to_str())
        .is_some_and(safe_component)
    {
        return Err("Invalid new project folder name".into());
    }
    if fs::symlink_metadata(destination).is_ok() {
        return Err("Destination already exists; choose a new folder".into());
    }
    let metadata = fs::symlink_metadata(archive).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("Archive must be a regular file".into());
    }
    let mut file = File::open(archive).map_err(|e| e.to_string())?;
    preflight(&mut file)?;
    let mut zip = ZipArchive::new(file).map_err(|e| e.to_string())?;
    if zip.len() > MAX_ENTRIES {
        return Err("Archive exceeds 10,000 entries".into());
    }
    let mut names = Names::default();
    let mut entries = Vec::new();
    let mut total = 0u64;
    for index in 0..zip.len() {
        let entry = zip.by_index(index).map_err(|e| e.to_string())?;
        let name = safe_name(entry.name())?;
        let directory = entry.is_dir();
        if let Some(mode) = entry.unix_mode() {
            let kind = mode & 0o170000;
            if kind != 0 && kind != if directory { 0o040000 } else { 0o100000 } {
                return Err("Archive links and special files are not allowed".into());
            }
        }
        names.add(&name, directory)?;
        total = total
            .checked_add(entry.size())
            .ok_or("Archive is too large")?;
        if entry.size() > MAX_FILE || total > MAX_TOTAL || (directory && entry.size() != 0) {
            return Err("Expanded archive exceeds size limits".into());
        }
        entries.push((name, directory, entry.size()));
    }
    // Reserve the new directory atomically. Never merge into or overwrite an existing project.
    fs::create_dir(destination).map_err(|e| e.to_string())?;
    let result = (|| -> Result<(), String> {
        for (index, (name, directory, size)) in entries.iter().enumerate() {
            let path = destination.join(name);
            if *directory {
                fs::create_dir_all(&path).map_err(|e| e.to_string())?;
            } else {
                fs::create_dir_all(path.parent().ok_or("Missing entry parent")?)
                    .map_err(|e| e.to_string())?;
                let mut output = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&path)
                    .map_err(|e| e.to_string())?;
                let mut input = zip
                    .by_index(index)
                    .map_err(|e| e.to_string())?
                    .take(size + 1);
                let copied = io::copy(&mut input, &mut output).map_err(|e| e.to_string())?;
                if copied != *size {
                    return Err("Archive entry size does not match its metadata".into());
                }
                output.flush().map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    })();
    if let Err(error) = result {
        return match fs::remove_dir_all(destination) {
            Ok(()) => Err(error),
            Err(cleanup) => Err(format!(
                "{error}; incomplete project cleanup failed: {cleanup}"
            )),
        };
    }
    Ok(())
}

#[tauri::command]
pub async fn pack_project(app: AppHandle) -> Result<Option<String>, String> {
    let operation = Operation::start()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        let state_path = crate::config_root::path(&app)?
            .join(crate::config::STATE_FILE);
        let root = active_root(&state_path)?;
        let name = format!(
            "{}.zip",
            root.file_name().unwrap_or_default().to_string_lossy()
        );
        let Some(selected) = app
            .dialog()
            .file()
            .set_title("Save project archive (new file)")
            .add_filter("Project ZIP", &["zip"])
            .set_file_name(name)
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path = selected.into_path().map_err(|e| e.to_string())?;
        // Re-check after the dialog: switching workspaces must not package a stale root.
        if active_root(&state_path)? != root {
            return Err("Active project changed; try again".into());
        }
        pack_into(&root, &path)?;
        Ok(Some(normalize(&path.to_string_lossy())))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn restore_project_archive(app: AppHandle) -> Result<Option<String>, String> {
    let operation = Operation::start()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        let Some(selected) = app
            .dialog()
            .file()
            .set_title("Restore project archive")
            .add_filter("Project ZIP", &["zip"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let archive = selected.into_path().map_err(|e| e.to_string())?;
        let name = format!(
            "{} restored",
            archive.file_stem().unwrap_or_default().to_string_lossy()
        );
        let Some(selected) = app
            .dialog()
            .file()
            .set_title("Choose a NEW project folder name and location")
            .set_file_name(name)
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let destination = selected.into_path().map_err(|e| e.to_string())?;
        restore_into(&archive, &destination)?;
        app.fs_scope()
            .allow_directory(&destination, true)
            .map_err(|e| e.to_string())?;
        Ok(Some(normalize(&destination.to_string_lossy())))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn scratch() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "grimoire-archive-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        eprintln!("archive test scratch: {}", path.display());
        path
    }
    fn fixture(path: &Path, names: &[(&str, &[u8])]) {
        let mut zip = ZipWriter::new(File::create(path).unwrap());
        for (name, bytes) in names {
            zip.start_file(
                *name,
                SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
            )
            .unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }
    #[test]
    fn roundtrip_preserves_all_project_files_and_empty_folders() {
        let base = scratch();
        let source = base.join("source");
        for dir in [
            "Draft",
            "Research",
            "Trash",
            "assets",
            "Research/empty",
            ".git",
            ".import-staging",
        ] {
            fs::create_dir_all(source.join(dir)).unwrap();
        }
        for (path, bytes) in [
            ("Draft/book.md", b"# Book".as_slice()),
            ("Research/notes.txt", b"research"),
            ("Trash/deleted.md", b"trash"),
            ("assets/image.bin", &[0, 255, 1]),
            (".metadata", b"{}"),
            (".git/config", b"private"),
            (".import-staging/tmp", b"partial"),
        ] {
            fs::write(source.join(path), bytes).unwrap();
        }
        let zip = base.join("project.zip");
        pack_into(&source, &zip).unwrap();
        let restored = base.join("restored");
        restore_into(&zip, &restored).unwrap();
        for path in [
            "Draft/book.md",
            "Research/notes.txt",
            "Trash/deleted.md",
            "assets/image.bin",
            ".metadata",
        ] {
            assert_eq!(
                fs::read(source.join(path)).unwrap(),
                fs::read(restored.join(path)).unwrap()
            );
        }
        assert!(!restored.join(".git").exists());
        assert!(!restored.join(".import-staging").exists());
        assert!(restored.join("Research/empty").is_dir());
        assert!(pack_into(&source, &zip).is_err());
        assert!(restore_into(&zip, &restored).is_err());
        assert_eq!(fs::read(restored.join("Draft/book.md")).unwrap(), b"# Book");
    }
    #[test]
    fn rejects_unsafe_names_and_collisions_without_destination() {
        let base = scratch();
        for (index, names) in [
            vec!["../escape"],
            vec!["/absolute"],
            vec!["C:/drive"],
            vec!["Draft\\escape"],
            vec!["NUL.txt"],
            vec!["trailing."],
            vec![".git/config"],
            vec!["A/book", "a/other"],
            vec!["file", "file/child"],
        ]
        .iter()
        .enumerate()
        {
            let zip = base.join(format!("{index}.zip"));
            let entries: Vec<_> = names
                .iter()
                .map(|name| (*name, b"bad".as_slice()))
                .collect();
            fixture(&zip, &entries);
            let destination = base.join(format!("restored-{index}"));
            assert!(restore_into(&zip, &destination).is_err(), "{names:?}");
            assert!(!destination.exists());
        }
        assert!(!base.join("escape").exists());
    }
    #[test]
    fn refuses_unremembered_workspace() {
        let base = scratch();
        let state = base.join("state.json");
        fs::write(
            &state,
            serde_json::json!({ "lastWorkspace": base, "recentWorkspaces": [] }).to_string(),
        )
        .unwrap();
        assert!(active_root(&state).is_err());
        fs::write(
            &state,
            serde_json::json!({ "lastWorkspace": base, "recentWorkspaces": [base] }).to_string(),
        )
        .unwrap();
        assert_eq!(
            active_root(&state).unwrap(),
            fs::canonicalize(&base).unwrap()
        );
    }
    #[test]
    fn rejects_archived_symlinks_and_oversized_metadata() {
        let base = scratch();
        let archive = base.join("symlink.zip");
        let mut zip = ZipWriter::new(File::create(&archive).unwrap());
        zip.add_symlink("Draft/link", "../../outside", SimpleFileOptions::default())
            .unwrap();
        zip.finish().unwrap();
        let destination = base.join("restored");
        assert!(restore_into(&archive, &destination)
            .unwrap_err()
            .contains("links"));
        assert!(!destination.exists());

        fixture(&archive, &[("Draft/book.md", b"small")]);
        let mut bytes = fs::read(&archive).unwrap();
        let central = bytes.windows(4).position(|v| v == b"PK\x01\x02").unwrap();
        bytes[central + 24..central + 28].copy_from_slice(&((MAX_FILE + 1) as u32).to_le_bytes());
        fs::write(&archive, &bytes).unwrap();
        assert!(restore_into(&archive, &destination).is_err());
        assert!(!destination.exists());
    }
    #[test]
    fn removes_partial_restore_after_crc_failure() {
        let base = scratch();
        let archive = base.join("corrupt.zip");
        fixture(
            &archive,
            &[
                ("Draft/good.md", b"keep"),
                ("Research/corrupt.md", b"change me"),
            ],
        );
        let mut bytes = fs::read(&archive).unwrap();
        let payload = bytes.windows(9).position(|v| v == b"change me").unwrap();
        bytes[payload] ^= 1;
        fs::write(&archive, &bytes).unwrap();
        let destination = base.join("restored");
        assert!(restore_into(&archive, &destination).is_err());
        assert!(!destination.exists());
        assert!(archive.exists());
    }
    #[test]
    fn rejects_archive_inside_source_without_creating_files() {
        let base = scratch();
        let destination = base.join("recursive.zip");
        assert!(pack_into(&base, &destination).is_err());
        assert!(!destination.exists());
        assert_eq!(fs::read_dir(&base).unwrap().count(), 0);
    }
}
