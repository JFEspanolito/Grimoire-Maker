use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Deserialize;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

pub struct ActiveSession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
}

#[derive(Default)]
pub struct TerminalState {
    pub session: Arc<Mutex<Option<ActiveSession>>>,
}

/// The page chooses only where the terminal opens and its size. The program it runs
/// is fixed here, so script running in the webview cannot start an arbitrary binary.
#[derive(Deserialize)]
pub struct SpawnOptions {
    pub cwd: Option<String>,
    pub rows: Option<u16>,
    pub cols: Option<u16>,
}

fn default_shell() -> String {
    if cfg!(target_os = "windows") {
        "powershell.exe".to_string()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
    }
}

const OUTSIDE_PROJECT: &str = "The terminal can only open inside the active project";

/// Resolves the folder the terminal opens in. It must be the active project or a
/// folder inside it; an empty request opens in the shell's default folder.
fn resolve_cwd(state_path: &Path, cwd: Option<&str>) -> Result<Option<PathBuf>, String> {
    let Some(cwd) = cwd.map(str::trim).filter(|cwd| !cwd.is_empty()) else {
        return Ok(None);
    };
    let selected = fs::canonicalize(cwd).map_err(|e| format!("Terminal folder unavailable: {e}"))?;
    if !selected.is_dir() {
        return Err("The terminal folder is not a directory".into());
    }
    let state: serde_json::Value =
        serde_json::from_slice(&fs::read(state_path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let active = state
        .get("lastWorkspace")
        .and_then(|value| value.as_str())
        .ok_or("No active project")?;
    let root = fs::canonicalize(active).map_err(|e| e.to_string())?;
    if !selected.starts_with(&root) {
        return Err(OUTSIDE_PROJECT.into());
    }
    // Native separators without the verbatim prefix, so the shell prompt shows a plain path.
    Ok(Some(Path::new(cwd).components().collect()))
}

#[tauri::command]
pub async fn spawn_terminal(
    app: AppHandle,
    state: State<'_, TerminalState>,
    options: Option<SpawnOptions>,
) -> Result<(), String> {
    let state_path = crate::config_root::path(&app)?.join(crate::config::STATE_FILE);
    let requested = options.as_ref().and_then(|o| o.cwd.clone());
    let cwd = tauri::async_runtime::spawn_blocking(move || resolve_cwd(&state_path, requested.as_deref()))
        .await
        .map_err(|e| e.to_string())??;

    let pty_system = native_pty_system();
    let rows = options.as_ref().and_then(|o| o.rows).unwrap_or(24);
    let cols = options.as_ref().and_then(|o| o.cols).unwrap_or(80);

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let mut cmd = CommandBuilder::new(default_shell());
    if let Some(cwd) = cwd {
        cmd.cwd(cwd);
    }

    let _child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    // Drop slave in the parent process so EOF works on child termination
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {}", e))?;

    let app_handle = app.clone();
    std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        while let Ok(n) = reader.read(&mut buffer) {
            if n == 0 {
                break;
            }
            let chunk = String::from_utf8_lossy(&buffer[..n]).to_string();
            if app_handle.emit("terminal-output", chunk).is_err() {
                break;
            }
        }
        let _ = app_handle.emit("terminal-exit", ());
    });

    let mut session_guard = state
        .session
        .lock()
        .map_err(|_| "Failed to lock terminal state".to_string())?;

    *session_guard = Some(ActiveSession {
        writer,
        master: pair.master,
    });

    Ok(())
}

#[tauri::command]
pub async fn write_terminal(
    state: State<'_, TerminalState>,
    data: String,
) -> Result<(), String> {
    let mut session_guard = state
        .session
        .lock()
        .map_err(|_| "Failed to lock terminal state".to_string())?;

    if let Some(session) = session_guard.as_mut() {
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Failed to write to terminal: {}", e))?;
        session
            .writer
            .flush()
            .map_err(|e| format!("Failed to flush terminal: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn resize_terminal(
    state: State<'_, TerminalState>,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let session_guard = state
        .session
        .lock()
        .map_err(|_| "Failed to lock terminal state".to_string())?;

    if let Some(session) = session_guard.as_ref() {
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to resize terminal: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn close_terminal(state: State<'_, TerminalState>) -> Result<(), String> {
    let mut session_guard = state
        .session
        .lock()
        .map_err(|_| "Failed to lock terminal state".to_string())?;

    *session_guard = None;
    Ok(())
}

#[cfg(test)]
mod terminal_tests {
    use super::*;

    #[test]
    fn terminal_state_defaults_to_none() {
        let state = TerminalState::default();
        let guard = state.session.lock().unwrap();
        assert!(guard.is_none());
    }

    struct Scratch(std::path::PathBuf);
    impl Scratch {
        fn path(&self) -> &std::path::Path { &self.0 }
    }
    impl Drop for Scratch {
        fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
    }

    fn project() -> (Scratch, std::path::PathBuf, std::path::PathBuf) {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let base = Scratch(std::env::temp_dir().join(format!(
            "grimoire-terminal-tests-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        )));
        let root = base.path().join("book");
        std::fs::create_dir_all(root.join("Draft")).unwrap();
        std::fs::create_dir_all(base.path().join("elsewhere")).unwrap();
        let state = base.path().join("state.json");
        std::fs::write(&state, serde_json::json!({ "lastWorkspace": root.to_str().unwrap() }).to_string()).unwrap();
        (base, root, state)
    }

    #[test]
    fn a_shell_sent_by_the_page_is_ignored() {
        let options: SpawnOptions = serde_json::from_value(serde_json::json!({ "shell": "cmd.exe", "rows": 10 })).unwrap();
        assert_eq!(options.rows, Some(10));
        assert_eq!(default_shell(), if cfg!(target_os = "windows") { "powershell.exe".to_string() } else { std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string()) });
    }

    #[test]
    fn the_terminal_opens_in_the_active_project_or_inside_it() {
        let (_base, root, state) = project();
        assert!(resolve_cwd(&state, Some(root.to_str().unwrap())).unwrap().is_some());
        assert!(resolve_cwd(&state, Some(root.join("Draft").to_str().unwrap())).unwrap().is_some());
        assert!(resolve_cwd(&state, None).unwrap().is_none());
        assert!(resolve_cwd(&state, Some("  ")).unwrap().is_none());
    }

    #[test]
    fn the_terminal_refuses_a_folder_outside_the_active_project() {
        let (base, root, state) = project();
        let outside = base.path().join("elsewhere");
        assert_eq!(resolve_cwd(&state, Some(outside.to_str().unwrap())).unwrap_err(), "The terminal can only open inside the active project");
        assert_eq!(resolve_cwd(&state, Some(root.join("Draft/../..").to_str().unwrap())).unwrap_err(), "The terminal can only open inside the active project");
        assert!(resolve_cwd(&state, Some(root.join("missing").to_str().unwrap())).is_err());
        std::fs::write(&state, "{}").unwrap();
        assert!(resolve_cwd(&state, Some(root.to_str().unwrap())).is_err());
    }
}
