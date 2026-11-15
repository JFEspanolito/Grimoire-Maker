use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

pub struct ActiveSession {
    id: String,
    child: Box<dyn Child + Send + Sync>,
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
}

impl Drop for ActiveSession {
    fn drop(&mut self) {
        if !matches!(self.child.try_wait(), Ok(Some(_))) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

#[derive(Default)]
pub struct SessionSlot {
    next_id: u64,
    active_id: Option<String>,
    session: Option<ActiveSession>,
}

#[derive(Default)]
pub struct TerminalState {
    pub session: Arc<Mutex<SessionSlot>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutput { session_id: String, data: String }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExit { session_id: String }

fn retire_session(sessions: &Mutex<SessionSlot>, id: &str) -> Result<(), String> {
    let mut slot = sessions.lock().map_err(|_| "Failed to lock terminal state")?;
    if slot.active_id.as_deref() == Some(id) {
        slot.active_id = None;
        slot.session = None;
    }
    Ok(())
}

fn decode_output(pending: &mut Vec<u8>, bytes: &[u8], eof: bool) -> String {
    pending.extend_from_slice(bytes);
    let mut output = String::new();
    let mut consumed = 0;
    while consumed < pending.len() {
        match std::str::from_utf8(&pending[consumed..]) {
            Ok(text) => { output.push_str(text); consumed = pending.len(); }
            Err(error) => {
                let valid_end = consumed + error.valid_up_to();
                output.push_str(&String::from_utf8_lossy(&pending[consumed..valid_end]));
                consumed = valid_end;
                if let Some(length) = error.error_len() {
                    output.push('\u{fffd}');
                    consumed += length;
                } else {
                    // Keep only the incomplete suffix, at most three bytes, until more arrive.
                    if eof {
                        output.push_str(&String::from_utf8_lossy(&pending[consumed..]));
                        consumed = pending.len();
                    }
                    break;
                }
            }
        }
    }
    pending.drain(..consumed);
    output
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
) -> Result<String, String> {
    let sessions = state.session.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state_path = crate::config_root::path(&app)?.join(crate::config::STATE_FILE);
        let cwd = resolve_cwd(&state_path, options.as_ref().and_then(|o| o.cwd.as_deref()))?;
        let mut slot = sessions.lock().map_err(|_| "Failed to lock terminal state")?;
        // Retire and reap the old child before starting its replacement.
        slot.session = None;
        slot.next_id += 1;
        let id = slot.next_id.to_string();
        slot.active_id = Some(id.clone());
        let pair = native_pty_system().openpty(PtySize {
            rows: options.as_ref().and_then(|o| o.rows).unwrap_or(24),
            cols: options.as_ref().and_then(|o| o.cols).unwrap_or(80),
            pixel_width: 0, pixel_height: 0,
        }).map_err(|e| format!("Failed to open PTY: {e}"))?;
        // Obtain fallible handles before spawning, so setup errors cannot orphan a child.
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let mut cmd = CommandBuilder::new(default_shell());
        if let Some(cwd) = cwd { cmd.cwd(cwd); }
        let child = pair.slave.spawn_command(cmd).map_err(|e| format!("Failed to spawn shell: {e}"))?;
        drop(pair.slave);
        slot.session = Some(ActiveSession { id: id.clone(), child, writer, master: pair.master });
        drop(slot);
        let session_id = id.clone();
        std::thread::spawn(move || {
            let mut buffer = [0u8; 4096];
            let mut pending = Vec::new();
            while let Ok(n) = reader.read(&mut buffer) {
                if n == 0 { break; }
                let data = decode_output(&mut pending, &buffer[..n], false);
                if app.emit("terminal-output", TerminalOutput { session_id: session_id.clone(), data }).is_err() { break; }
            }
            let data = decode_output(&mut pending, &[], true);
            if !data.is_empty() {
                let _ = app.emit("terminal-output", TerminalOutput { session_id: session_id.clone(), data });
            }
            drop(reader);
            let _ = retire_session(&sessions, &session_id);
            let _ = app.emit("terminal-exit", TerminalExit { session_id });
        });
        Ok(id)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn write_terminal(state: State<'_, TerminalState>, session_id: String, data: String) -> Result<(), String> {
    let sessions = state.session.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut slot = sessions.lock().map_err(|_| "Failed to lock terminal state")?;
        if let Some(session) = slot.session.as_mut().filter(|s| s.id == session_id) {
            session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
            session.writer.flush().map_err(|e| e.to_string())?;
        }
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn resize_terminal(state: State<'_, TerminalState>, session_id: String, rows: u16, cols: u16) -> Result<(), String> {
    let sessions = state.session.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let slot = sessions.lock().map_err(|_| "Failed to lock terminal state")?;
        if let Some(session) = slot.session.as_ref().filter(|s| s.id == session_id) {
            session.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())?;
        }
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn close_terminal(state: State<'_, TerminalState>, session_id: String) -> Result<(), String> {
    let sessions = state.session.clone();
    tauri::async_runtime::spawn_blocking(move || retire_session(&sessions, &session_id))
        .await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod terminal_tests {
    use super::*;

    #[test]
    fn terminal_utf8_survives_every_chunk_boundary_and_flushes_incomplete_eof() {
        for bytes in ["ASCII é ñ 🪲 end".as_bytes(), &[0xff, b'a', 0xe2, b'(', 0xa1], &[b'a', 0xf0, 0x9f]] {
            for split in 0..=bytes.len() {
                let mut pending = Vec::new();
                let mut text = decode_output(&mut pending, &bytes[..split], false);
                text.push_str(&decode_output(&mut pending, &bytes[split..], false));
                text.push_str(&decode_output(&mut pending, &[], true));
                assert_eq!(text, String::from_utf8_lossy(bytes), "split at {split}");
                assert!(pending.is_empty());
            }
        }
        let mut pending = Vec::new();
        let mut text = String::new();
        for byte in "éñ🪲".as_bytes() {
            text.push_str(&decode_output(&mut pending, &[*byte], false));
            assert!(pending.len() <= 3);
        }
        assert_eq!(text, "éñ🪲");
    }

    #[derive(Debug, Clone)]
    struct TestChild(Arc<Mutex<Vec<&'static str>>>);
    impl portable_pty::ChildKiller for TestChild {
        fn kill(&mut self) -> std::io::Result<()> { self.0.lock().unwrap().push("kill"); Ok(()) }
        fn clone_killer(&self) -> Box<dyn portable_pty::ChildKiller + Send + Sync> { Box::new(self.clone()) }
    }
    impl Child for TestChild {
        fn try_wait(&mut self) -> std::io::Result<Option<portable_pty::ExitStatus>> { Ok(None) }
        fn wait(&mut self) -> std::io::Result<portable_pty::ExitStatus> {
            self.0.lock().unwrap().push("wait"); Ok(portable_pty::ExitStatus::with_exit_code(0))
        }
        fn process_id(&self) -> Option<u32> { None }
        #[cfg(windows)]
        fn as_raw_handle(&self) -> Option<std::os::windows::io::RawHandle> { None }
    }
    fn test_session(id: &str, events: Arc<Mutex<Vec<&'static str>>>) -> ActiveSession {
        let pair = native_pty_system().openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 }).unwrap();
        drop(pair.slave);
        ActiveSession { id: id.into(), child: Box::new(TestChild(events)), writer: Box::new(Vec::<u8>::new()), master: pair.master }
    }

    #[test]
    fn retired_children_are_killed_reaped_once_and_stale_cleanup_is_ignored() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sessions = Mutex::new(SessionSlot {
            next_id: 2, active_id: Some("new".into()), session: Some(test_session("new", events.clone())),
        });
        retire_session(&sessions, "old").unwrap();
        assert!(events.lock().unwrap().is_empty());
        assert_eq!(sessions.lock().unwrap().session.as_ref().unwrap().id, "new");
        retire_session(&sessions, "new").unwrap();
        retire_session(&sessions, "new").unwrap();
        assert_eq!(*events.lock().unwrap(), vec!["kill", "wait"]);
        assert!(sessions.lock().unwrap().session.is_none());
    }

    #[test]
    fn terminal_events_identify_the_session() {
        assert_eq!(serde_json::to_value(TerminalOutput { session_id: "id".into(), data: "prompt".into() }).unwrap(),
            serde_json::json!({ "sessionId": "id", "data": "prompt" }));
        assert_eq!(serde_json::to_value(TerminalExit { session_id: "id".into() }).unwrap(),
            serde_json::json!({ "sessionId": "id" }));
    }

    #[test]
    fn terminal_state_defaults_to_none() {
        let state = TerminalState::default();
        let guard = state.session.lock().unwrap();
        assert!(guard.session.is_none());
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
