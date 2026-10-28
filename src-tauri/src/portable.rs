//! Portable mode and the installer's content-folder hint.
//!
//! Portable mode is selected by a regular `portable.flag` file next to the executable. The
//! configuration root is then `<exe folder>/Data` and the app code writes nothing to `%APPDATA%`
//! or `%LOCALAPPDATA%`. The WebView2 user data folder is moved into `Data/WebView2` by creating
//! the main window with an explicit data directory (see `lib.rs`); that is what keeps
//! `%LOCALAPPDATA%` untouched, because Tauri otherwise forces `%LOCALAPPDATA%/<identifier>`.
//!
//! The installer hands its chosen "Content folders" path over in `install-content-root.txt` inside the
//! configuration root. Everything here is pure and path based so it can be tested with temp dirs.
use crate::safe_copy::open_checked;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::OnceLock,
};

pub const FLAG_FILE: &str = "portable.flag";
pub const DATA_DIRECTORY: &str = "Data";
pub const WEBVIEW_DIRECTORY: &str = "WebView2";
pub const HINT_FILE: &str = "install-content-root.txt";
pub const HINT_APPLIED_FILE: &str = "install-content-root.txt.applied";
/// The five content folders of the portable and installer layouts, in the app's existing naming.
pub const LIBRARY_FOLDERS: [&str; 5] = ["Plugins", "Snippets", "Templates", "Themes", "Logs"];
const MAX_HINT_BYTES: u64 = 1024;
const MAX_HINT_CHARS: usize = 240;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// Config root `%APPDATA%/GriomoireMaker`, today's defaults (an installer hint may still apply).
    Normal,
    /// Config root `<exe folder>/Data`.
    Portable,
}

static ACTIVE: OnceLock<Mode> = OnceLock::new();

/// Recorded once by `config_root::initialize`. Code and tests that run without an app see `Normal`.
pub fn set_active(mode: Mode) {
    let _ = ACTIVE.set(mode);
}

pub fn active() -> Mode {
    ACTIVE.get().copied().unwrap_or(Mode::Normal)
}

/// The folder that holds the running executable, if it can be determined.
pub fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
}

/// Portable only for a regular file; a folder or a link named `portable.flag` does not count.
pub fn detect(exe_dir: &Path) -> Mode {
    match fs::symlink_metadata(exe_dir.join(FLAG_FILE)) {
        Ok(meta) if meta.is_file() => Mode::Portable,
        _ => Mode::Normal,
    }
}

pub fn data_dir(exe_dir: &Path) -> PathBuf {
    exe_dir.join(DATA_DIRECTORY)
}

/// Pure decision: only a portable run moves the WebView2 user data folder.
pub fn webview_data_dir(mode: Mode, config: &Path) -> Option<PathBuf> {
    (mode == Mode::Portable).then(|| config.join(WEBVIEW_DIRECTORY))
}

/// Creates `<exe dir>/Data` when missing and proves it is writable. There is no fallback location.
pub fn prepare_data_dir(exe_dir: &Path) -> Result<PathBuf, String> {
    let data = data_dir(exe_dir);
    let fail = |error: String| {
        format!(
            "Portable mode needs a writable folder, but {} cannot be used: {error}. Move Grimoire Maker to a folder you can write to; nothing is stored in %APPDATA%.",
            data.display()
        )
    };
    match fs::symlink_metadata(&data) {
        Ok(meta) if meta.is_dir() => (),
        Ok(_) => return Err(fail("it exists but is not a regular folder".into())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&data).map_err(|error| fail(error.to_string()))?;
        }
        Err(error) => return Err(fail(error.to_string())),
    }
    let probe = data.join(format!(".write-test-{}", std::process::id()));
    fs::write(&probe, b"").map_err(|error| fail(error.to_string()))?;
    fs::remove_file(&probe).map_err(|error| fail(error.to_string()))?;
    Ok(data)
}

#[derive(Debug, PartialEq)]
pub enum Hint {
    Absent,
    /// The validated content root, with `/` separators and no trailing separator.
    Valid(String),
    Invalid(String),
}

pub fn read_hint(config: &Path) -> Hint {
    let path = config.join(HINT_FILE);
    let meta = match fs::symlink_metadata(&path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Hint::Absent,
        Err(error) => return Hint::Invalid(error.to_string()),
    };
    if !meta.is_file() {
        return Hint::Invalid("the hint is not a regular file".into());
    }
    if meta.len() > MAX_HINT_BYTES {
        return Hint::Invalid("the hint is larger than 1 KiB".into());
    }
    let read = || -> Result<Vec<u8>, String> {
        let mut bytes = Vec::new();
        open_checked(&path, false)?
            .take(MAX_HINT_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        Ok(bytes)
    };
    match read().and_then(|bytes| parse_hint(&bytes, config)) {
        Ok(root) => Hint::Valid(root),
        Err(reason) => Hint::Invalid(reason),
    }
}

/// Renames the hint once its paths are persisted. A failure only leaves the (now ignored) hint behind.
pub fn mark_hint_applied(config: &Path) -> Result<(), String> {
    fs::rename(config.join(HINT_FILE), config.join(HINT_APPLIED_FILE)).map_err(|e| e.to_string())
}

const DEVICE_NAMES: [&str; 24] = [
    "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$", "COM1", "COM2", "COM3", "COM4", "COM5",
    "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7",
    "LPT8", "LPT9",
];

fn valid_component(part: &str) -> Result<(), String> {
    if part.is_empty() {
        return Err("the path has an empty segment".into());
    }
    if part == "." || part == ".." {
        return Err("the path contains a relative segment".into());
    }
    if part.chars().any(|c| "<>:\"|?*".contains(c)) {
        return Err("the path contains a character Windows does not allow".into());
    }
    if part.ends_with('.') || part.ends_with(' ') {
        return Err("a path segment ends with a dot or a space".into());
    }
    let stem = part.split('.').next().unwrap_or(part).trim_end().to_uppercase();
    if DEVICE_NAMES.contains(&stem.as_str()) {
        return Err("the path contains a Windows device name".into());
    }
    Ok(())
}

/// Decodes the hint bytes: UTF-8 (BOM tolerated) or, as the NSIS installer writes it, UTF-16LE with a BOM.
fn decode_hint_text(bytes: &[u8]) -> Result<String, String> {
    if let Some(body) = bytes.strip_prefix(&[0xff, 0xfe]) {
        if body.len() % 2 != 0 {
            return Err("the hint is not valid UTF-16".into());
        }
        let units: Vec<u16> = body.chunks_exact(2).map(|pair| u16::from_le_bytes([pair[0], pair[1]])).collect();
        return String::from_utf16(&units).map_err(|_| "the hint is not valid UTF-16".to_string());
    }
    std::str::from_utf8(bytes).map(str::to_owned).map_err(|_| "the hint is not valid UTF-8".to_string())
}

/// Validates the hint text and returns the normalized root. Only the first line may carry a path.
pub fn parse_hint(bytes: &[u8], config: &Path) -> Result<String, String> {
    let decoded = decode_hint_text(bytes)?;
    let text = decoded.strip_prefix('\u{feff}').unwrap_or(&decoded);
    let mut lines = text.split('\n').map(|line| line.strip_suffix('\r').unwrap_or(line));
    let first = lines.next().unwrap_or_default().trim();
    if first.is_empty() {
        return Err("the hint is empty".into());
    }
    if lines.any(|line| !line.trim().is_empty()) {
        return Err("the hint must contain exactly one line".into());
    }
    if first.chars().any(char::is_control) {
        return Err("the hint contains control characters".into());
    }
    if first.chars().count() > MAX_HINT_CHARS {
        return Err("the hint path is too long".into());
    }
    let normalized = first.replace('\\', "/");
    let rest = if let Some(unc) = normalized.strip_prefix("//") {
        // Device namespaces and administrative shares are never content folders.
        let mut parts = unc.split('/');
        let (host, share) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
        if host.is_empty() || share.is_empty() || host == "?" || host == "." {
            return Err("the hint is not a usable network path".into());
        }
        if share.ends_with('$') {
            return Err("administrative shares are not allowed".into());
        }
        valid_component(host)?;
        valid_component(share)?;
        unc.splitn(3, '/').nth(2).unwrap_or("").to_string()
    } else {
        let bytes = normalized.as_bytes();
        if bytes.len() < 3 || !bytes[0].is_ascii_alphabetic() || bytes[1] != b':' || bytes[2] != b'/' {
            return Err("the hint must be an absolute Windows path".into());
        }
        normalized[3..].to_string()
    };
    let rest = rest.trim_end_matches('/');
    if !rest.is_empty() {
        for part in rest.split('/') {
            valid_component(part)?;
        }
    }
    let root = normalized.trim_end_matches('/').to_string();
    let root = if root.ends_with(':') { format!("{root}/") } else { root };
    // The library folders must not live inside the configuration root they would be mixed with.
    if crate::config_root::is_inside(&root, config) {
        return Err("the hint points inside the application configuration folder".into());
    }
    Ok(root.trim_end_matches('/').to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch(name: &str) -> PathBuf {
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "grimoire-portable-{name}-{}-{stamp}",
            std::process::id()
        ));
        fs::create_dir(&dir).unwrap();
        dir
    }
    fn config() -> PathBuf {
        PathBuf::from("C:/Users/test/AppData/Roaming/GriomoireMaker")
    }
    fn hint(text: &str) -> Result<String, String> {
        parse_hint(text.as_bytes(), &config())
    }
    fn link(link: &Path, target: &Path) {
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

    #[test]
    fn mode_is_portable_only_for_a_regular_flag_file() {
        let exe = scratch("mode");
        assert_eq!(detect(&exe), Mode::Normal);
        fs::write(exe.join(FLAG_FILE), "").unwrap();
        assert_eq!(detect(&exe), Mode::Portable);
        fs::remove_file(exe.join(FLAG_FILE)).unwrap();
        fs::create_dir(exe.join(FLAG_FILE)).unwrap();
        assert_eq!(detect(&exe), Mode::Normal);
        fs::remove_dir(exe.join(FLAG_FILE)).unwrap();
        let target = scratch("mode-target");
        link(&exe.join(FLAG_FILE), &target);
        assert_eq!(detect(&exe), Mode::Normal);
        assert_eq!(detect(&exe.join("missing")), Mode::Normal);
    }

    #[test]
    fn webview_folder_moves_only_in_portable_mode() {
        let config = Path::new("X:/App/Data");
        assert_eq!(
            webview_data_dir(Mode::Portable, config),
            Some(PathBuf::from("X:/App/Data/WebView2"))
        );
        assert_eq!(webview_data_dir(Mode::Normal, config), None);
    }

    #[test]
    fn portable_data_folder_is_created_and_reused() {
        let exe = scratch("data");
        let data = prepare_data_dir(&exe).unwrap();
        assert_eq!(data, exe.join("Data"));
        assert!(data.is_dir());
        fs::write(data.join("keep.txt"), "kept").unwrap();
        assert_eq!(prepare_data_dir(&exe).unwrap(), data);
        assert_eq!(fs::read_to_string(data.join("keep.txt")).unwrap(), "kept");
        assert!(fs::read_dir(&data).unwrap().all(|e| !e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".write-test")));
    }

    #[test]
    fn portable_data_folder_that_cannot_be_used_is_a_plain_error() {
        let exe = scratch("data-blocked");
        fs::write(exe.join("Data"), "a file in the way").unwrap();
        let error = prepare_data_dir(&exe).unwrap_err();
        assert!(error.contains("writable") && error.contains("Data"), "{error}");
        let error = prepare_data_dir(&exe.join("missing/deeper")).unwrap_err();
        assert!(error.contains("writable"), "{error}");
        assert!(!exe.join("missing").exists());
    }

    #[test]
    fn valid_hints_are_normalized() {
        assert_eq!(hint("C:\\Users\\me\\Documents\\Grimoire Maker").unwrap(), "C:/Users/me/Documents/Grimoire Maker");
        assert_eq!(hint("D:/Books/Grimoire/\r\n").unwrap(), "D:/Books/Grimoire");
        assert_eq!(hint("  E:\\Games  \n\n  \n").unwrap(), "E:/Games");
        assert_eq!(hint("\u{feff}C:\\Content").unwrap(), "C:/Content");
        assert_eq!(hint("\\\\server\\share\\Grimoire").unwrap(), "//server/share/Grimoire");
        assert_eq!(hint("C:\\").unwrap(), "C:");
    }

    #[test]
    fn utf16le_hints_with_a_bom_are_accepted() {
        let utf16 = |text: &str| -> Vec<u8> {
            let mut bytes = vec![0xff, 0xfe];
            bytes.extend(text.encode_utf16().flat_map(u16::to_le_bytes));
            bytes
        };
        let config = config();
        assert_eq!(
            parse_hint(&utf16("C:\\Users\\José Ñandú\\Док\\Grimoire Maker\r\n"), &config).unwrap(),
            "C:/Users/José Ñandú/Док/Grimoire Maker"
        );
        assert!(parse_hint(&utf16("Relative"), &config).is_err());
        // Unpaired surrogate and truncated code unit.
        assert!(parse_hint(&[0xff, 0xfe, 0x00, 0xd8], &config).is_err());
        assert!(parse_hint(&[0xff, 0xfe, b'C', 0x00, b':'], &config).is_err());
    }

    #[test]
    fn invalid_hints_are_rejected() {
        for bad in [
            "",
            "   \n",
            "Documents\\Grimoire",
            "C:Grimoire",
            "\\Grimoire",
            "C:\\a\\..\\b",
            "C:\\a\\.\\b",
            "C:\\a\\\\b",
            "\\\\server\\C$\\Grimoire",
            "\\\\server\\admin$",
            "\\\\?\\C:\\Grimoire",
            "\\\\.\\PhysicalDrive0",
            "\\\\server",
            "C:\\a\u{7}b",
            "C:\\a\tb",
            "C:\\CON",
            "C:\\books\\nul.txt",
            "C:\\LPT1",
            "C:\\a<b",
            "C:\\a?b",
            "C:\\trailing.",
            "C:\\mid \\x",
            "C:\\first\nD:\\second",
            "C:\\first\r\nD:\\second\n",
        ] {
            assert!(hint(bad).is_err(), "{bad:?} must be rejected");
        }
        assert!(parse_hint(&[0xff, 0xfe, b'C'], &config()).is_err());
        assert!(hint(&format!("C:\\{}", "a".repeat(300))).is_err());
        // Extra blank lines are fine; a second path is not.
        assert!(hint("C:\\ok\n\n").is_ok());
    }

    #[test]
    fn hint_inside_the_config_root_is_rejected() {
        let config = Path::new("C:/Users/test/AppData/Roaming/GriomoireMaker");
        for inside in [
            "C:\\Users\\test\\AppData\\Roaming\\GriomoireMaker",
            "c:/users/test/appdata/roaming/griomoiremaker/Content",
        ] {
            assert!(parse_hint(inside.as_bytes(), config).is_err(), "{inside}");
        }
        assert!(parse_hint(b"C:\\Users\\test\\AppData\\Roaming\\GriomoireMaker2", config).is_ok());
        assert!(parse_hint(b"C:\\Users\\test\\Documents", config).is_ok());
    }

    #[test]
    fn hint_file_must_be_a_small_regular_file() {
        let config = scratch("hint-file");
        assert_eq!(read_hint(&config), Hint::Absent);
        fs::write(config.join(HINT_FILE), "D:\\Books\\Grimoire\r\n").unwrap();
        assert_eq!(read_hint(&config), Hint::Valid("D:/Books/Grimoire".into()));
        fs::write(config.join(HINT_FILE), format!("D:\\{}", "a".repeat(2000))).unwrap();
        assert!(matches!(read_hint(&config), Hint::Invalid(_)));
        fs::write(config.join(HINT_FILE), [0xc3, 0x28]).unwrap();
        assert!(matches!(read_hint(&config), Hint::Invalid(_)));
        fs::write(config.join(HINT_FILE), "").unwrap();
        assert!(matches!(read_hint(&config), Hint::Invalid(_)));
        fs::remove_file(config.join(HINT_FILE)).unwrap();
        fs::create_dir(config.join(HINT_FILE)).unwrap();
        assert!(matches!(read_hint(&config), Hint::Invalid(_)));
        fs::remove_dir(config.join(HINT_FILE)).unwrap();
        let target = scratch("hint-target");
        link(&config.join(HINT_FILE), &target);
        assert!(matches!(read_hint(&config), Hint::Invalid(_)));
    }

    #[test]
    fn marking_the_hint_applied_renames_it() {
        let config = scratch("hint-applied");
        fs::write(config.join(HINT_FILE), "D:\\Books").unwrap();
        mark_hint_applied(&config).unwrap();
        assert!(!config.join(HINT_FILE).exists());
        assert_eq!(fs::read_to_string(config.join(HINT_APPLIED_FILE)).unwrap(), "D:\\Books");
        assert_eq!(read_hint(&config), Hint::Absent);
    }
}
