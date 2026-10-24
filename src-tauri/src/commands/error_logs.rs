//! Bounded, native-owned text logs. Never delete or overwrite an existing segment.
use super::preferences::{
    default_logs, lock_ancestors, logs_directory_locked, reject_special, CHANGES,
};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const MAX_MESSAGE_BYTES: usize = 16 * 1024;
const MAX_SEGMENT_BYTES: u64 = 1024 * 1024;
const MAX_SEGMENTS: usize = 16;
static CONFIG: OnceLock<PathBuf> = OnceLock::new();

fn bounded(text: &str, maximum: usize) -> &str {
    let mut end = text.len().min(maximum);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

fn entry(source: &str, message: &str) -> Result<String, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?;
    let source: String = bounded(source, 80)
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || "._-".contains(character) {
                character
            } else {
                '_'
            }
        })
        .collect();
    let body: String = bounded(message, MAX_MESSAGE_BYTES)
        .chars()
        .filter(|character| !character.is_control() || *character == '\n' || *character == '\t')
        .collect();
    let truncated = if message.len() > MAX_MESSAGE_BYTES {
        "\n[message truncated]"
    } else {
        ""
    };
    Ok(format!(
        "[UTC unix {}.{:03}] [{source}] {body}{truncated}\n",
        timestamp.as_secs(),
        timestamp.subsec_millis()
    ))
}

fn open_segment(path: &Path) -> Result<File, String> {
    let exists = match fs::symlink_metadata(path) {
        Ok(info) => {
            reject_special(&info)?;
            if !info.is_file() {
                return Err("Log segment is not a regular file".into());
            }
            true
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(error.to_string()),
    };
    let mut options = OpenOptions::new();
    options.append(true).read(true);
    if !exists {
        options.create_new(true);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // Open reparse points themselves; prevent rename/delete/write sharing while appending.
        options.custom_flags(0x00200000).share_mode(1);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        #[cfg(any(target_os = "linux", target_os = "android"))]
        options.custom_flags(0x20000); // O_NOFOLLOW
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "freebsd"))]
        options.custom_flags(0x100); // O_NOFOLLOW
    }
    let file = options.open(path).map_err(|e| e.to_string())?;
    let info = file.metadata().map_err(|e| e.to_string())?;
    reject_special(&info)?;
    if !info.is_file() {
        return Err("Log segment is not a regular file".into());
    }
    // Hard links are not reparse points. Do not append to another file through an alias.
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if info.nlink() != 1 {
            return Err("Hard-linked log files are not supported".into());
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        #[repr(C)]
        #[allow(non_snake_case)]
        struct FileInformation {
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
        unsafe extern "system" {
            fn GetFileInformationByHandle(
                handle: *mut std::ffi::c_void,
                info: *mut FileInformation,
            ) -> i32;
        }
        let mut information = std::mem::MaybeUninit::<FileInformation>::uninit();
        // SAFETY: live file handle and correctly sized writable Win32 output structure.
        let success =
            unsafe { GetFileInformationByHandle(file.as_raw_handle(), information.as_mut_ptr()) };
        if success == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        // SAFETY: the successful Win32 call initialized the structure.
        if unsafe { information.assume_init() }.links != 1 {
            return Err("Hard-linked log files are not supported".into());
        }
    }
    Ok(file)
}

// Caller holds CHANGES for the complete directory resolution and append.
fn append_directory(directory: &Path, source: &str, message: &str) -> Result<(), String> {
    let mut locks = Vec::new();
    lock_ancestors(directory, &mut locks)?;
    let entry = entry(source, message)?;
    for index in 1..=MAX_SEGMENTS {
        let mut output = open_segment(&directory.join(format!("errors-{index:04}.txt")))?;
        let size = output.metadata().map_err(|e| e.to_string())?.len();
        if size > MAX_SEGMENT_BYTES {
            return Err(
                "Existing log exceeds the segment limit; inspect and archive it manually".into(),
            );
        }
        if size + entry.len() as u64 > MAX_SEGMENT_BYTES {
            continue;
        }
        return output
            .write_all(entry.as_bytes())
            .and_then(|_| output.sync_data())
            .map_err(|e| e.to_string());
    }
    Err("Logs reached 16 MiB capacity; manually archive numbered logs outside Logs Path. No logs were deleted".into())
}

pub(super) fn append_in(config: &Path, source: &str, message: &str) -> Result<(), String> {
    let _guard = CHANGES.lock().map_err(|e| e.to_string())?;
    append_directory(&logs_directory_locked(config)?, source, message)
}

#[tauri::command]
pub async fn append_error_log(
    app: AppHandle,
    source: String,
    message: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        append_in(
            &app.path().app_config_dir().map_err(|e| e.to_string())?,
            &source,
            &message,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Startup failures and panic hooks must never deadlock a settings/path operation.
pub fn best_effort(source: &str, message: &str) {
    let Some(config) = CONFIG.get() else {
        return;
    };
    best_effort_in(config, source, message);
}

fn best_effort_in(config: &Path, source: &str, message: &str) {
    let Ok(_guard) = CHANGES.try_lock() else {
        return;
    };
    // A corrupt preference file cannot direct logging. Use only the checked default in that case.
    if let Ok(directory) = logs_directory_locked(config).or_else(|_| default_logs(config)) {
        let _ = append_directory(&directory, source, message);
    }
}

pub fn initialize(app: &AppHandle) {
    if let Ok(config) = app.path().app_config_dir() {
        if CONFIG.set(config).is_ok() {
            let previous = std::panic::take_hook();
            std::panic::set_hook(Box::new(move |info| {
                best_effort("native.panic", &info.to_string());
                previous(info);
            }));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn scratch(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "grimoire-error-logs-{name}-{}-{stamp}",
            std::process::id()
        ));
        fs::create_dir(&path).unwrap();
        eprintln!("error logs scratch retained: {}", path.display());
        path
    }
    #[test]
    fn error_logs_append_native_named_utc_text_and_bound_entries() {
        let config = scratch("append");
        append_in(&config, "test\nspoof", "first failure").unwrap();
        append_in(&config, "test", &"é".repeat(MAX_MESSAGE_BYTES)).unwrap();
        let contents = fs::read_to_string(config.join("logs/errors-0001.txt")).unwrap();
        assert!(contents.starts_with("[UTC unix "));
        assert!(contents.contains("[test_spoof] first failure"));
        assert!(contents.ends_with("[message truncated]\n"));
        assert!(contents.len() < MAX_MESSAGE_BYTES + 256);
    }
    #[test]
    fn error_logs_rotate_and_stop_at_capacity_without_deleting_files() {
        let config = scratch("rotation");
        append_in(&config, "test", "initial").unwrap();
        let directory = config.join("logs");
        let first = directory.join("errors-0001.txt");
        OpenOptions::new()
            .write(true)
            .open(&first)
            .unwrap()
            .set_len(MAX_SEGMENT_BYTES)
            .unwrap();
        fs::write(directory.join("user-notes.txt"), "keep me").unwrap();
        append_in(&config, "test", "rotated").unwrap();
        assert!(fs::read_to_string(directory.join("errors-0002.txt"))
            .unwrap()
            .contains("rotated"));
        for index in 2..=MAX_SEGMENTS {
            OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(false)
                .open(directory.join(format!("errors-{index:04}.txt")))
                .unwrap()
                .set_len(MAX_SEGMENT_BYTES)
                .unwrap();
        }
        assert!(append_in(&config, "test", "over capacity")
            .unwrap_err()
            .contains("capacity"));
        assert_eq!(fs::metadata(first).unwrap().len(), MAX_SEGMENT_BYTES);
        assert_eq!(
            fs::read_to_string(directory.join("user-notes.txt")).unwrap(),
            "keep me"
        );
        assert_eq!(fs::read_dir(directory).unwrap().count(), MAX_SEGMENTS + 1);
    }
    #[test]
    fn error_logs_reject_hardlinks_without_modifying_target() {
        let config = scratch("hardlink");
        let directory = default_logs(&config).unwrap();
        let outside = config.join("private.txt");
        fs::write(&outside, "private").unwrap();
        fs::hard_link(&outside, directory.join("errors-0001.txt")).unwrap();
        assert!(append_directory(&directory, "test", "must not append").is_err());
        assert_eq!(fs::read_to_string(outside).unwrap(), "private");
    }
    #[test]
    fn error_logs_reject_directory_links() {
        let config = scratch("links");
        let outside = config.join("outside");
        fs::create_dir(&outside).unwrap();
        let link = config.join("linked");
        #[cfg(windows)]
        assert!(std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(&link)
            .arg(&outside)
            .output()
            .unwrap()
            .status
            .success());
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        assert!(append_directory(&link, "test", "must not append").is_err());
        assert_eq!(fs::read_dir(outside).unwrap().count(), 0);
    }
    #[test]
    fn error_logs_panic_path_never_waits_for_changes_and_keeps_corrupt_settings() {
        let config = scratch("panic-lock");
        {
            let _guard = CHANGES.lock().unwrap();
            best_effort_in(&config, "native.panic", "locked");
            assert!(!config.join("logs").exists());
        }
        fs::write(config.join("setting.json"), "{broken").unwrap();
        // Use the held-lock helper directly after acquiring the same try-lock as production,
        // avoiding test scheduling against other append tests when proving the fallback.
        let _guard = CHANGES.lock().unwrap();
        let directory = logs_directory_locked(&config)
            .or_else(|_| default_logs(&config))
            .unwrap();
        append_directory(&directory, "native.startup", "invalid preferences").unwrap();
        assert!(fs::read_to_string(directory.join("errors-0001.txt"))
            .unwrap()
            .contains("invalid preferences"));
        assert_eq!(
            fs::read_to_string(config.join("setting.json")).unwrap(),
            "{broken"
        );
    }
}
