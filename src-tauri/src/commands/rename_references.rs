//! Bounded, recoverable same-parent file rename and Markdown replacement transaction.
use crate::safe_copy::{lock_ancestors, open_checked, reject_special};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use tauri::AppHandle;
use tauri_plugin_fs::FsExt;

pub(crate) static CHANGES: Mutex<()> = Mutex::new(());
const TRANSACTION: &str = ".grimoire-rename-transaction";
const MAX_ENTRIES: usize = 5_000;
const MAX_DOCUMENT: usize = 4 * 1024 * 1024;
const MAX_TOTAL: usize = 32 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct RenameDocument {
    pub path: String,
    pub before: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct RenameReplacement {
    pub path: String,
    pub before: String,
    pub after: String,
}
#[derive(Debug, Serialize)]
pub struct RenameSnapshot {
    pub documents: Vec<RenameDocument>,
}

#[tauri::command]
pub async fn snapshot_rename_references(
    app: AppHandle,
    root: String,
    from: String,
    to: String,
) -> Result<RenameSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = CHANGES.lock().map_err(|e| e.to_string())?;
        let state = crate::config_root::path(&app)?.join(crate::config::STATE_FILE);
        snapshot_in(
            &state,
            Path::new(&root),
            Path::new(&from),
            Path::new(&to),
            &|path| app.fs_scope().is_allowed(path),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn commit_rename_references(
    app: AppHandle,
    root: String,
    from: String,
    to: String,
    documents: Vec<RenameReplacement>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = CHANGES.lock().map_err(|e| e.to_string())?;
        let state = crate::config_root::path(&app)?.join(crate::config::STATE_FILE);
        commit_in(
            &state,
            Path::new(&root),
            Path::new(&from),
            Path::new(&to),
            documents,
            &|path| app.fs_scope().is_allowed(path),
            &mut |_| Ok(()),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

pub(crate) fn portable(path: &Path) -> Result<String, String> {
    let raw = path
        .to_str()
        .ok_or("Paths must be valid Unicode")?
        .replace('\\', "/");
    Ok(if let Some(unc) = raw.strip_prefix("//?/UNC/") {
        format!("//{unc}")
    } else {
        raw.strip_prefix("//?/").unwrap_or(&raw).to_string()
    })
}

pub(crate) fn clean_absolute(path: &Path) -> Result<(), String> {
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
    {
        return Err("Rename paths must be absolute without traversal segments".into());
    }
    for part in path.components() {
        if let Component::Normal(name) = part {
            let name = name.to_str().ok_or("Paths must be valid Unicode")?;
            if name
                .chars()
                .any(|c| c.is_control() || ":*?\"<>|".contains(c))
                || name.ends_with([' ', '.'])
            {
                return Err("Unsupported path component".into());
            }
        }
    }
    Ok(())
}

fn absent(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
        Ok(_) => Err(format!("Destination already exists: {}", path.display())),
    }
}

fn check_single_link(file: &File) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if file.metadata().map_err(|e| e.to_string())?.nlink() != 1 {
            return Err("Hard-linked files are not supported for reference renaming".into());
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        #[repr(C)]
        struct Information {
            attributes: u32,
            creation: [u32; 2],
            access: [u32; 2],
            write: [u32; 2],
            volume: u32,
            size_high: u32,
            size_low: u32,
            links: u32,
            index_high: u32,
            index_low: u32,
        }
        #[link(name = "kernel32")]
        extern "system" {
            fn GetFileInformationByHandle(
                handle: *mut std::ffi::c_void,
                information: *mut Information,
            ) -> i32;
        }
        let mut information = std::mem::MaybeUninit::<Information>::uninit();
        // SAFETY: the live file handle and writable Win32 structure have matching layouts.
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), information.as_mut_ptr()) }
            == 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
        // SAFETY: the successful call initialized the complete structure.
        if unsafe { information.assume_init() }.links != 1 {
            return Err("Hard-linked files are not supported for reference renaming".into());
        }
    }
    Ok(())
}

fn regular(path: &Path) -> Result<File, String> {
    let file = open_checked(path, false)?;
    check_single_link(&file)?;
    Ok(file)
}

fn bounded_text(file: &mut File, maximum: usize) -> Result<String, String> {
    if file.metadata().map_err(|e| e.to_string())?.len() > maximum as u64 {
        return Err("Rename snapshot file size limit exceeded".into());
    }
    let mut bytes = Vec::new();
    file.take(maximum as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > maximum {
        return Err("Rename snapshot file size limit exceeded".into());
    }
    String::from_utf8(bytes)
        .map_err(|_| "Markdown reference inventory contains invalid UTF-8".into())
}

struct Verified {
    root: PathBuf,
    from: PathBuf,
    to: PathBuf,
    locks: Vec<File>,
}

/// Checks that the root is absolute, inside the granted scope and the active remembered
/// workspace. Returns the canonical root and the directory locks that guard it.
pub(crate) fn verify_root(
    state_path: &Path,
    root: &Path,
    allowed: &dyn Fn(&Path) -> bool,
) -> Result<(PathBuf, Vec<File>), String> {
    clean_absolute(root)?;
    if !allowed(root) {
        return Err(format!(
            "Path is outside the granted filesystem scope: {}",
            root.display()
        ));
    }
    let mut locks = Vec::new();
    lock_ancestors(root, &mut locks)?;
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let state: serde_json::Value =
        serde_json::from_str(&bounded_text(&mut regular(state_path)?, 1024 * 1024)?)
            .map_err(|e| e.to_string())?;
    let matches_root = |value: &str| {
        fs::canonicalize(value)
            .map(|path| path == root)
            .unwrap_or(false)
    };
    if !state
        .get("lastWorkspace")
        .and_then(serde_json::Value::as_str)
        .is_some_and(matches_root)
        || !state
            .get("recentWorkspaces")
            .and_then(serde_json::Value::as_array)
            .is_some_and(|values| {
                values
                    .iter()
                    .filter_map(serde_json::Value::as_str)
                    .any(matches_root)
            })
    {
        return Err("Reference rename requires the active remembered workspace".into());
    }
    Ok((root, locks))
}

fn verify_paths(
    state_path: &Path,
    root: &Path,
    from: &Path,
    to: &Path,
    allowed: &dyn Fn(&Path) -> bool,
) -> Result<Verified, String> {
    for path in [from, to] {
        clean_absolute(path)?;
        if !allowed(path) {
            return Err(format!(
                "Path is outside the granted filesystem scope: {}",
                path.display()
            ));
        }
    }
    let (root, mut locks) = verify_root(state_path, root, allowed)?;
    let parent = from.parent().ok_or("Cannot rename a filesystem root")?;
    lock_ancestors(parent, &mut locks)?;
    let parent = fs::canonicalize(parent).map_err(|e| e.to_string())?;
    let target_parent = to.parent().ok_or("Cannot rename a filesystem root")?;
    lock_ancestors(target_parent, &mut locks)?;
    if fs::canonicalize(target_parent).map_err(|e| e.to_string())? != parent
        || !parent.starts_with(&root)
    {
        return Err("Only same-parent file renames inside the active project are supported".into());
    }
    let from = parent.join(from.file_name().ok_or("Missing source file name")?);
    let to = parent.join(to.file_name().ok_or("Missing destination file name")?);
    if from == to {
        return Err("Source and destination names must differ".into());
    }
    let destination_name = to
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_ascii_uppercase();
    if matches!(destination_name.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (destination_name.len() == 4
            && (destination_name.starts_with("COM") || destination_name.starts_with("LPT"))
            && destination_name.as_bytes()[3].is_ascii_digit())
    {
        return Err("Reserved destination file name".into());
    }
    drop(regular(&from)?);
    absent(&to)?;
    let recovery = root.join(TRANSACTION);
    if fs::symlink_metadata(&recovery).is_ok() {
        return Err(format!("A rename recovery transaction remains at {}. Inspect journal.jsonl and backups before another rename; do not delete recovery data until files are reconciled.", recovery.display()));
    }
    absent(&recovery)?;
    Ok(Verified {
        root,
        from,
        to,
        locks,
    })
}

pub(crate) struct LockedDocument {
    pub(crate) path: PathBuf,
    pub(crate) before: String,
    _file: File,
}
fn inventory(
    verified: &mut Verified,
    allowed: &dyn Fn(&Path) -> bool,
) -> Result<Vec<LockedDocument>, String> {
    inventory_in(&verified.root, &mut verified.locks, allowed, &|_, _| false)
}

/// Locks and reads every Markdown document below `root`. `skip(path, name)` excludes a
/// directory (and everything below it) from the walk; `.git` is always excluded.
pub(crate) fn inventory_in(
    root: &Path,
    locks: &mut Vec<File>,
    allowed: &dyn Fn(&Path) -> bool,
    skip: &dyn Fn(&Path, &str) -> bool,
) -> Result<Vec<LockedDocument>, String> {
    fn walk(
        path: &Path,
        depth: usize,
        entries: &mut usize,
        bytes: &mut usize,
        found: &mut Vec<LockedDocument>,
        locks: &mut Vec<File>,
        allowed: &dyn Fn(&Path) -> bool,
        skip: &dyn Fn(&Path, &str) -> bool,
    ) -> Result<(), String> {
        if depth > 32 {
            return Err("Markdown inventory exceeds 32 directory levels".into());
        }
        for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            *entries += 1;
            if *entries > MAX_ENTRIES {
                return Err("Markdown inventory exceeds 5000 entries".into());
            }
            let path = entry.path();
            let name = entry.file_name();
            let name = name
                .to_str()
                .ok_or("Project entry names must be valid Unicode")?;
            if name.eq_ignore_ascii_case(".git") {
                continue;
            }
            let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
            if metadata.is_dir() && skip(&path, name) {
                continue;
            }
            reject_special(&metadata)?;
            if !allowed(&path) {
                return Err(format!(
                    "Project inventory is outside granted filesystem scope: {}",
                    path.display()
                ));
            }
            if metadata.is_dir() {
                locks.push(open_checked(&path, true)?);
                walk(&path, depth + 1, entries, bytes, found, locks, allowed, skip)?;
            } else if path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
            {
                let mut file = regular(&path)?;
                let before = bounded_text(&mut file, MAX_DOCUMENT)?;
                *bytes += before.len();
                if *bytes > MAX_TOTAL {
                    return Err("Markdown inventory exceeds 32 MiB".into());
                }
                found.push(LockedDocument {
                    path,
                    before,
                    _file: file,
                });
            }
        }
        Ok(())
    }
    let mut result = Vec::new();
    walk(root, 0, &mut 0, &mut 0, &mut result, locks, allowed, skip)?;
    result.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(result)
}

fn snapshot_in(
    state: &Path,
    root: &Path,
    from: &Path,
    to: &Path,
    allowed: &dyn Fn(&Path) -> bool,
) -> Result<RenameSnapshot, String> {
    let mut verified = verify_paths(state, root, from, to, allowed)?;
    let documents = inventory(&mut verified, allowed)?
        .into_iter()
        .map(|document| {
            Ok(RenameDocument {
                path: portable(&document.path)?,
                before: document.before,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(RenameSnapshot { documents })
}

/// Unlike std::fs::rename, publication must never replace a concurrently created destination.
fn move_new(from: &Path, to: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        extern "system" {
            fn MoveFileExW(from: *const u16, to: *const u16, flags: u32) -> i32;
        }
        let from: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
        // SAFETY: both paths are null-terminated UTF-16. WRITE_THROUGH, without REPLACE_EXISTING.
        if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 8) } == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::ffi::OsStrExt;
        extern "C" {
            fn renameat2(
                old_dir: i32,
                old_path: *const std::ffi::c_char,
                new_dir: i32,
                new_path: *const std::ffi::c_char,
                flags: u32,
            ) -> i32;
        }
        let from =
            std::ffi::CString::new(from.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
        let to = std::ffi::CString::new(to.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
        // SAFETY: owned C strings and AT_FDCWD descriptors; RENAME_NOREPLACE is atomic.
        if unsafe { renameat2(-100, from.as_ptr(), -100, to.as_ptr(), 1) } != 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::ffi::OsStrExt;
        extern "C" {
            fn renamex_np(
                from: *const std::ffi::c_char,
                to: *const std::ffi::c_char,
                flags: u32,
            ) -> i32;
        }
        let from =
            std::ffi::CString::new(from.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
        let to = std::ffi::CString::new(to.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
        // SAFETY: owned C strings; RENAME_EXCL refuses an existing destination.
        if unsafe { renamex_np(from.as_ptr(), to.as_ptr(), 4) } != 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(())
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = (from, to);
        Err("No atomic no-replace rename implementation for this platform".into())
    }
}

fn same_file_bytes(first: &Path, second: &Path) -> Result<bool, String> {
    let mut first = regular(first)?;
    let mut second = regular(second)?;
    if first.metadata().map_err(|e| e.to_string())?.len()
        != second.metadata().map_err(|e| e.to_string())?.len()
    {
        return Ok(false);
    }
    let mut a = [0u8; 64 * 1024];
    let mut b = [0u8; 64 * 1024];
    loop {
        let count = first.read(&mut a).map_err(|e| e.to_string())?;
        if count == 0 {
            return Ok(true);
        }
        second
            .read_exact(&mut b[..count])
            .map_err(|e| e.to_string())?;
        if a[..count] != b[..count] {
            return Ok(false);
        }
    }
}

fn expect_bytes(path: &Path, expected: &[u8]) -> Result<(), String> {
    let file = regular(path)?;
    if file.metadata().map_err(|e| e.to_string())?.len() != expected.len() as u64 {
        return Err(format!("File changed during rename: {}", path.display()));
    }
    let mut actual = Vec::new();
    file.take(expected.len() as u64 + 1)
        .read_to_end(&mut actual)
        .map_err(|e| e.to_string())?;
    if actual != expected {
        return Err(format!("File changed during rename: {}", path.display()));
    }
    Ok(())
}

pub(crate) struct Operation {
    original: PathBuf,
    target: PathBuf,
    staged: PathBuf,
    backup: PathBuf,
    discarded: PathBuf,
    before: Option<Vec<u8>>,
    after: Option<Vec<u8>>,
    backed_up: bool,
    published: bool,
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())
}

fn journal(file: &mut File, value: serde_json::Value) -> Result<(), String> {
    let mut line = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
    line.push(b'\n');
    file.write_all(&line)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())
}

fn cleanup(directory: &Path, operations: &[Operation]) -> Result<(), String> {
    for path in operations
        .iter()
        .flat_map(|op| [&op.staged, &op.backup, &op.discarded])
        .cloned()
        .chain([directory.join("journal.jsonl"), directory.join("committed")])
    {
        match fs::symlink_metadata(&path) {
            Ok(info) => {
                reject_special(&info)?;
                if !info.is_file() {
                    return Err("Unexpected directory in rename recovery data".into());
                }
                fs::remove_file(path).map_err(|e| e.to_string())?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    // Windows can report a just-emptied directory as non-empty while deletions settle.
    let mut result = fs::remove_dir(directory);
    for _ in 0..40 {
        if result.is_ok() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
        result = fs::remove_dir(directory);
    }
    result.map_err(|e| e.to_string())
}

fn rollback(
    operations: &mut [Operation],
    checkpoint: &mut dyn FnMut(&str) -> Result<(), String>,
) -> Result<(), String> {
    let mut errors = Vec::new();
    for op in operations.iter_mut().rev() {
        let restore = (|| {
            if !op.backed_up {
                return Ok(());
            }
            checkpoint("before-rollback")?;
            if let Some(before) = &op.before {
                expect_bytes(&op.backup, before)?;
            }
            if op.published {
                if let Some(after) = &op.after {
                    expect_bytes(&op.target, after)?;
                } else if !same_file_bytes(&op.target, &op.backup)? {
                    return Err("Published source changed; preserving concurrent edit".into());
                }
                move_new(&op.target, &op.discarded)?;
                op.published = false;
            }
            // An external file at the original path is never overwritten.
            move_new(&op.backup, &op.original)?;
            op.backed_up = false;
            Ok::<(), String>(())
        })();
        if let Err(error) = restore {
            errors.push(format!("{}: {error}", op.original.display()));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn commit_in(
    state: &Path,
    root: &Path,
    from: &Path,
    to: &Path,
    documents: Vec<RenameReplacement>,
    allowed: &dyn Fn(&Path) -> bool,
    checkpoint: &mut dyn FnMut(&str) -> Result<(), String>,
) -> Result<(), String> {
    let mut verified = verify_paths(state, root, from, to, allowed)?;
    let snapshot = inventory(&mut verified, allowed)?;
    if documents.len() != snapshot.len() {
        return Err("Markdown inventory changed or the submitted snapshot is incomplete".into());
    }
    let mut replacements = BTreeMap::new();
    let mut after_total = 0usize;
    for replacement in documents {
        if replacement.before.len() > MAX_DOCUMENT || replacement.after.len() > MAX_DOCUMENT {
            return Err("Markdown replacement exceeds 4 MiB".into());
        }
        after_total += replacement.after.len();
        if after_total > MAX_TOTAL {
            return Err("Markdown replacements exceed 32 MiB".into());
        }
        clean_absolute(Path::new(&replacement.path))?;
        let key = portable(Path::new(&replacement.path))?;
        if replacements.insert(key, replacement).is_some() {
            return Err("Duplicate Markdown snapshot path".into());
        }
    }
    for file in &snapshot {
        let submitted = replacements
            .get(&portable(&file.path)?)
            .ok_or("Markdown inventory changed or snapshot contains another path")?;
        if submitted.before != file.before {
            return Err(format!(
                "Markdown changed since snapshot: {}",
                file.path.display()
            ));
        }
    }
    let transaction = verified.root.join(TRANSACTION);
    if !allowed(&transaction) {
        return Err("Rename transaction directory is outside granted scope".into());
    }
    let mut operations = Vec::new();
    let source_document = replacements.get(&portable(&verified.from)?);
    operations.push(Operation {
        original: verified.from.clone(),
        target: verified.to.clone(),
        staged: transaction.join("0.stage"),
        backup: transaction.join("0.backup"),
        discarded: transaction.join("0.discarded"),
        before: source_document.map(|d| d.before.as_bytes().to_vec()),
        after: source_document.map(|d| d.after.as_bytes().to_vec()),
        backed_up: false,
        published: false,
    });
    for file in &snapshot {
        if file.path == verified.from {
            continue;
        }
        let submitted = &replacements[&portable(&file.path)?];
        if submitted.before == submitted.after {
            continue;
        }
        let index = operations.len();
        operations.push(Operation {
            original: file.path.clone(),
            target: file.path.clone(),
            staged: transaction.join(format!("{index}.stage")),
            backup: transaction.join(format!("{index}.backup")),
            discarded: transaction.join(format!("{index}.discarded")),
            before: Some(submitted.before.as_bytes().to_vec()),
            after: Some(submitted.after.as_bytes().to_vec()),
            backed_up: false,
            published: false,
        });
    }
    run_transaction(&transaction, operations, snapshot, checkpoint, "Rename")
}

/// Builds the operation that overwrites `path` in place with `after` (no rename step).
pub(crate) fn replace_operation(
    transaction: &Path,
    index: usize,
    path: &Path,
    before: &str,
    after: &str,
) -> Operation {
    Operation {
        original: path.to_path_buf(),
        target: path.to_path_buf(),
        staged: transaction.join(format!("{index}.stage")),
        backup: transaction.join(format!("{index}.backup")),
        discarded: transaction.join(format!("{index}.discarded")),
        before: Some(before.as_bytes().to_vec()),
        after: Some(after.as_bytes().to_vec()),
        backed_up: false,
        published: false,
    }
}

pub(crate) fn transaction_dir(root: &Path) -> PathBuf {
    root.join(TRANSACTION)
}

pub(crate) const DOCUMENT_LIMIT: usize = MAX_DOCUMENT;
pub(crate) const TOTAL_LIMIT: usize = MAX_TOTAL;

/// Stages, backs up and publishes every operation with a rollback journal. On any failure
/// all originals are restored; `verb` only words the user-facing messages.
pub(crate) fn run_transaction(
    transaction: &Path,
    mut operations: Vec<Operation>,
    snapshot: Vec<LockedDocument>,
    checkpoint: &mut dyn FnMut(&str) -> Result<(), String>,
    verb: &str,
) -> Result<(), String> {
    fs::create_dir(transaction).map_err(|e| e.to_string())?;
    let transaction_lock = open_checked(transaction, true)?;
    let result = (|| {
        let mut log = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(transaction.join("journal.jsonl"))
            .map_err(|e| e.to_string())?;
        journal(
            &mut log,
            serde_json::json!({"version":1,"state":"prepared","entries":operations.iter().map(|op| serde_json::json!({"original":op.original,"target":op.target,"staged":op.staged,"backup":op.backup,"discarded":op.discarded})).collect::<Vec<_>>()}),
        )?;
        for op in &operations {
            checkpoint("before-stage")?;
            if let Some(after) = &op.after {
                write_new(&op.staged, after)?;
            } else {
                let mut input = regular(&op.original)?;
                let mut output = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&op.staged)
                    .map_err(|e| e.to_string())?;
                std::io::copy(&mut input, &mut output).map_err(|e| e.to_string())?;
                output.sync_all().map_err(|e| e.to_string())?;
            }
            fs::set_permissions(
                &op.staged,
                fs::metadata(&op.original)
                    .map_err(|e| e.to_string())?
                    .permissions(),
            )
            .map_err(|e| e.to_string())?;
        }
        // No live source read handles may remain when Windows performs a deliberate rename.
        drop(snapshot);
        for (index, op) in operations.iter_mut().enumerate() {
            checkpoint("before-backup")?;
            if let Some(before) = &op.before {
                expect_bytes(&op.original, before)?;
            } else if !same_file_bytes(&op.original, &op.staged)? {
                return Err("Source changed while staging rename".into());
            }
            journal(
                &mut log,
                serde_json::json!({"operation":index,"state":"moving-original"}),
            )?;
            move_new(&op.original, &op.backup)?;
            op.backed_up = true;
            checkpoint("after-backup")?;
            checkpoint("before-publish")?;
            move_new(&op.staged, &op.target)?;
            op.published = true;
            journal(
                &mut log,
                serde_json::json!({"operation":index,"state":"published"}),
            )?;
            checkpoint("after-publish")?;
        }
        checkpoint("before-finalize")?;
        write_new(
            &transaction.join("committed"),
            b"All outputs published. Backups are recovery copies of pre-rename originals.\n",
        )?;
        Ok::<(), String>(())
    })();
    if let Err(error) = result {
        let restored = rollback(&mut operations, checkpoint);
        drop(transaction_lock);
        if let Err(rollback_error) = restored {
            return Err(format!("{verb} failed: {error}. Rollback incomplete: {rollback_error}. Recovery data retained at {}. Inspect journal.jsonl before retrying.", transaction.display()));
        }
        if let Err(cleanup_error) = cleanup(transaction, &operations) {
            return Err(format!("{verb} failed and originals were restored: {error}. Recovery cleanup failed: {cleanup_error}. Inspect {} before retrying.", transaction.display()));
        }
        return Err(format!("{verb} failed; original files restored: {error}"));
    }
    drop(transaction_lock);
    // A cleanup error cannot turn a confirmed commit into a false failed rename.
    // The durable committed marker explains the residue; the next invocation refuses it.
    if let Err(error) = cleanup(transaction, &operations) {
        eprintln!(
            "{verb} committed; recovery cleanup needed at {}: {error}",
            transaction.display()
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    struct Fixture {
        base: PathBuf,
        root: PathBuf,
        state: PathBuf,
        from: PathBuf,
        to: PathBuf,
    }
    fn fixture() -> Fixture {
        let base = std::env::temp_dir().join(format!(
            "grimoire-rename-tests-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&base).unwrap();
        let root = base.join("project");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("image.png"), b"image bytes").unwrap();
        fs::write(root.join("one.md"), "![Image](image.png)\r\n").unwrap();
        fs::write(root.join("two.MD"), "[Image](image.png)\n").unwrap();
        let state = base.join("state.json");
        fs::write(&state, serde_json::json!({"lastWorkspace":root.to_str().unwrap(),"recentWorkspaces":[root.to_str().unwrap()]}).to_string()).unwrap();
        eprintln!("rename test scratch: {}", base.display());
        Fixture {
            from: root.join("image.png"),
            to: root.join("renamed.png"),
            root,
            state,
            base,
        }
    }
    fn plan(f: &Fixture) -> Vec<RenameReplacement> {
        snapshot_in(&f.state, &f.root, &f.from, &f.to, &|_| true)
            .unwrap()
            .documents
            .into_iter()
            .map(|d| RenameReplacement {
                path: d.path,
                after: d.before.replace("image.png", "renamed.png"),
                before: d.before,
            })
            .collect()
    }
    fn assert_original(f: &Fixture) {
        assert_eq!(fs::read(&f.from).unwrap(), b"image bytes");
        assert!(!f.to.exists());
        assert_eq!(
            fs::read(f.root.join("one.md")).unwrap(),
            b"![Image](image.png)\r\n"
        );
        assert_eq!(
            fs::read(f.root.join("two.MD")).unwrap(),
            b"[Image](image.png)\n"
        );
    }
    #[test]
    fn complete_inventory_and_commit_preserve_newlines() {
        let f = fixture();
        let docs = plan(&f);
        assert_eq!(docs.len(), 2);
        commit_in(
            &f.state,
            &f.root,
            &f.from,
            &f.to,
            docs,
            &|_| true,
            &mut |_| Ok(()),
        )
        .unwrap();
        assert!(!f.from.exists());
        assert_eq!(fs::read(&f.to).unwrap(), b"image bytes");
        assert_eq!(
            fs::read(f.root.join("one.md")).unwrap(),
            b"![Image](renamed.png)\r\n"
        );
        assert_eq!(
            fs::read(f.root.join("two.MD")).unwrap(),
            b"[Image](renamed.png)\n"
        );
    }
    #[test]
    fn rejects_missing_snapshot_document_and_changed_bytes_before_writes() {
        let f = fixture();
        let mut docs = plan(&f);
        docs.pop();
        assert!(commit_in(
            &f.state,
            &f.root,
            &f.from,
            &f.to,
            docs,
            &|_| true,
            &mut |_| Ok(())
        )
        .is_err());
        assert_original(&f);
        let docs = plan(&f);
        fs::write(f.root.join("one.md"), "external edit").unwrap();
        assert!(commit_in(
            &f.state,
            &f.root,
            &f.from,
            &f.to,
            docs,
            &|_| true,
            &mut |_| Ok(())
        )
        .is_err());
        assert_eq!(
            fs::read_to_string(f.root.join("one.md")).unwrap(),
            "external edit"
        );
        assert!(f.from.exists());
        assert!(!f.to.exists());
    }
    #[test]
    fn rolls_back_after_partial_publication() {
        let f = fixture();
        let docs = plan(&f);
        let mut count = 0;
        let error = commit_in(
            &f.state,
            &f.root,
            &f.from,
            &f.to,
            docs,
            &|_| true,
            &mut |point| {
                if point == "after-publish" {
                    count += 1;
                    if count == 2 {
                        return Err("injected publication failure".into());
                    }
                }
                Ok(())
            },
        )
        .unwrap_err();
        assert!(error.contains("injected publication failure"));
        assert_original(&f);
    }
    #[test]
    fn unauthorized_or_existing_destination_never_changes_files() {
        let f = fixture();
        assert!(snapshot_in(&f.state, &f.root, &f.from, &f.to, &|_| false).is_err());
        assert_original(&f);
        fs::write(&f.to, "existing").unwrap();
        assert!(snapshot_in(&f.state, &f.root, &f.from, &f.to, &|_| true).is_err());
        assert_eq!(fs::read_to_string(&f.to).unwrap(), "existing");
        fs::write(&f.state, "{}").unwrap();
        assert!(snapshot_in(
            &f.state,
            &f.root,
            &f.from,
            &f.root.join("other.png"),
            &|_| true
        )
        .is_err());
        assert!(f.base.exists());
    }

    #[test]
    fn staging_and_backup_failures_restore_originals() {
        for failure in ["before-stage", "after-backup", "before-finalize"] {
            let f = fixture();
            let error = commit_in(
                &f.state,
                &f.root,
                &f.from,
                &f.to,
                plan(&f),
                &|_| true,
                &mut |point| {
                    if point == failure {
                        Err("injected failure".into())
                    } else {
                        Ok(())
                    }
                },
            )
            .unwrap_err();
            assert!(
                error.contains("original files restored"),
                "{failure}: {error}"
            );
            assert_original(&f);
            assert!(!f.root.join(TRANSACTION).exists());
        }
    }

    #[test]
    fn incomplete_rollback_retains_backups_and_blocks_retry() {
        let f = fixture();
        let error = commit_in(
            &f.state,
            &f.root,
            &f.from,
            &f.to,
            plan(&f),
            &|_| true,
            &mut |point| {
                if point == "after-backup" || point == "before-rollback" {
                    Err("injected failure".into())
                } else {
                    Ok(())
                }
            },
        )
        .unwrap_err();
        let recovery = f.root.join(TRANSACTION);
        assert!(error.contains("Rollback incomplete"));
        assert_eq!(fs::read(recovery.join("0.backup")).unwrap(), b"image bytes");
        assert!(recovery.join("journal.jsonl").exists());
        // An unrelated source still cannot start a new transaction over remnants.
        assert!(snapshot_in(
            &f.state,
            &f.root,
            &f.root.join("one.md"),
            &f.root.join("other.md"),
            &|_| true
        )
        .unwrap_err()
        .contains("recovery"));
    }

    #[test]
    fn rollback_never_overwrites_concurrent_edit() {
        let f = fixture();
        let error = commit_in(
            &f.state,
            &f.root,
            &f.from,
            &f.to,
            plan(&f),
            &|_| true,
            &mut |point| {
                if point == "after-publish" {
                    fs::write(&f.to, b"external edit").unwrap();
                    return Err("injected failure".into());
                }
                Ok(())
            },
        )
        .unwrap_err();
        assert!(error.contains("Rollback incomplete"));
        assert_eq!(fs::read(&f.to).unwrap(), b"external edit");
        assert_eq!(
            fs::read(f.root.join(TRANSACTION).join("0.backup")).unwrap(),
            b"image bytes"
        );
    }

    #[test]
    fn added_document_and_hardlinks_are_rejected() {
        let f = fixture();
        let docs = plan(&f);
        fs::write(f.root.join("new.md"), "new document").unwrap();
        assert!(commit_in(
            &f.state,
            &f.root,
            &f.from,
            &f.to,
            docs,
            &|_| true,
            &mut |_| Ok(())
        )
        .is_err());
        assert_original(&f);
        fs::hard_link(&f.from, f.root.join("alias.png")).unwrap();
        assert!(snapshot_in(&f.state, &f.root, &f.from, &f.to, &|_| true).is_err());
        assert_original(&f);
    }

    #[test]
    fn markdown_source_is_renamed_with_its_transformed_contents() {
        let mut f = fixture();
        f.from = f.root.join("one.md");
        f.to = f.root.join("renamed.md");
        let docs = plan(&f);
        commit_in(
            &f.state,
            &f.root,
            &f.from,
            &f.to,
            docs,
            &|_| true,
            &mut |_| Ok(()),
        )
        .unwrap();
        assert!(!f.from.exists());
        assert_eq!(fs::read(&f.to).unwrap(), b"![Image](renamed.png)\r\n");
        assert_eq!(
            fs::read(f.root.join("two.MD")).unwrap(),
            b"[Image](renamed.png)\n"
        );
    }

    #[test]
    fn oversized_or_non_utf8_markdown_is_rejected_without_writes() {
        let f = fixture();
        fs::write(f.root.join("large.md"), vec![b'a'; MAX_DOCUMENT + 1]).unwrap();
        assert!(snapshot_in(&f.state, &f.root, &f.from, &f.to, &|_| true).is_err());
        assert_original(&f);
        fs::write(f.root.join("large.md"), [0xff]).unwrap();
        assert!(snapshot_in(&f.state, &f.root, &f.from, &f.to, &|_| true).is_err());
        assert_original(&f);
    }
}
