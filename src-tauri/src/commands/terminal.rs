use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Deserialize;
use std::io::{Read, Write};
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

#[derive(Deserialize)]
pub struct SpawnOptions {
    pub cwd: Option<String>,
    pub shell: Option<String>,
    pub rows: Option<u16>,
    pub cols: Option<u16>,
}

#[tauri::command]
pub async fn spawn_terminal(
    app: AppHandle,
    state: State<'_, TerminalState>,
    options: Option<SpawnOptions>,
) -> Result<(), String> {
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

    let default_shell = if cfg!(target_os = "windows") {
        "powershell.exe".to_string()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
    };

    let shell = options
        .as_ref()
        .and_then(|o| o.shell.clone())
        .unwrap_or(default_shell);

    let mut cmd = CommandBuilder::new(shell);
    if let Some(cwd) = options.as_ref().and_then(|o| o.cwd.as_deref()) {
        if !cwd.trim().is_empty() {
            cmd.cwd(cwd);
        }
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
}
