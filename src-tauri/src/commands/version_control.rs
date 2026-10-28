//! Local source control. Every operation is bound to the active project root.

use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::AppHandle;

const OUTPUT_LIMIT: usize = 512 * 1024;
static OPERATIONS: Mutex<()> = Mutex::new(());

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitEntry {
    path: String,
    original_path: Option<String>,
    index_status: String,
    worktree_status: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    hash: String,
    short_hash: String,
    subject: String,
    timestamp: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryStatus {
    is_repository: bool,
    branch: String,
    entries: Vec<GitEntry>,
    commits: Vec<GitCommit>,
    index_fingerprint: String,
}

#[derive(Debug, Serialize)]
pub struct GitDiff {
    text: String,
    binary: bool,
    truncated: bool,
}

struct Output {
    success: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    truncated: bool,
}

/// Drain both pipes even after the preview limit, without retaining unbounded data.
fn drain(mut pipe: impl Read) -> std::io::Result<(Vec<u8>, bool)> {
    let mut output = Vec::new();
    let mut truncated = false;
    let mut buffer = [0; 8192];
    loop {
        let size = pipe.read(&mut buffer)?;
        if size == 0 {
            return Ok((output, truncated));
        }
        let keep = size.min(OUTPUT_LIMIT.saturating_sub(output.len()));
        output.extend_from_slice(&buffer[..keep]);
        truncated |= keep < size;
    }
}

fn git_start_error(error: std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::NotFound {
        "Source Control requires Git. Please download it from https://git-scm.com/install/.".into()
    } else {
        format!("Could not start Git: {error}")
    }
}

fn execute(root: &Path, args: &[String], extra_config: &[String]) -> Result<Output, String> {
    let mut command = Command::new("git");
    command
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Ambient Git environment must not redirect the repository, index, config or helpers.
    for (key, _) in std::env::vars_os() {
        if key
            .to_string_lossy()
            .to_ascii_uppercase()
            .starts_with("GIT_")
        {
            command.env_remove(key);
        }
    }
    command
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_LITERAL_PATHSPECS", "1")
        .env("GIT_ATTR_NOSYSTEM", "1")
        .env("GIT_PAGER", "")
        .env("LC_ALL", "C");
    command.arg("--no-pager");
    for value in [
        "core.hooksPath=/dev/null",
        "core.fsmonitor=false",
        "core.untrackedCache=false",
        "core.attributesFile=/dev/null",
        "commit.gpgSign=false",
        "tag.gpgSign=false",
        "gc.auto=0",
        "maintenance.auto=false",
        "diff.external=",
        "core.askPass=",
        "credential.helper=",
        "core.sshCommand=false",
        "color.ui=false",
    ] {
        command.args(["-c", value]);
    }
    for value in extra_config {
        command.arg("-c").arg(value);
    }
    command.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn().map_err(git_start_error)?;
    let stdout = child.stdout.take().ok_or("Git stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("Git stderr unavailable")?;
    let out = std::thread::spawn(move || drain(stdout));
    let err = std::thread::spawn(move || drain(stderr));
    let started = Instant::now();
    let mut timed_out = false;
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if started.elapsed() > Duration::from_secs(20) {
            timed_out = true;
            let _ = child.kill();
            break child.wait().map_err(|e| e.to_string())?;
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    let (stdout, out_truncated) = out
        .join()
        .map_err(|_| "Git output reader failed")?
        .map_err(|e| e.to_string())?;
    let (stderr, err_truncated) = err
        .join()
        .map_err(|_| "Git error reader failed")?
        .map_err(|e| e.to_string())?;
    if timed_out {
        return Err("Git exceeded 20 seconds and was stopped. Refresh before retrying; a mutation may already have completed.".into());
    }
    Ok(Output {
        success: status.success(),
        stdout,
        stderr,
        truncated: out_truncated || err_truncated,
    })
}

fn git(root: &Path, args: &[&str]) -> Result<Output, String> {
    // Clean/smudge/process drivers can execute arbitrary project-selected programs during add.
    // Discover the configured names using a read-only builtin, then override every driver.
    let keys = execute(
        root,
        &[
            "config".into(),
            "--null".into(),
            "--name-only".into(),
            "--get-regexp".into(),
            "^filter\\..*\\.(clean|smudge|process|required)$".into(),
        ],
        &[],
    )?;
    if keys.truncated {
        return Err("Git filter configuration exceeds the safe limit".into());
    }
    if !keys.success && !keys.stderr.is_empty() {
        return Err(String::from_utf8_lossy(&keys.stderr).into_owned());
    }
    let mut overrides = Vec::new();
    for key in keys
        .stdout
        .split(|byte| *byte == 0)
        .filter(|key| !key.is_empty())
    {
        let key = std::str::from_utf8(key).map_err(|_| "Unsupported Git filter name")?;
        if key.contains(['=', '\n', '\r']) {
            return Err("Unsupported Git filter name".into());
        }
        overrides.push(format!(
            "{key}={}",
            if key.ends_with(".required") {
                "false"
            } else {
                ""
            }
        ));
    }
    execute(
        root,
        &args
            .iter()
            .map(|arg| (*arg).to_string())
            .collect::<Vec<_>>(),
        &overrides,
    )
}

fn checked(root: &Path, args: &[&str]) -> Result<Output, String> {
    let output = git(root, args)?;
    if !output.success {
        return Err(format!(
            "Git failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(output)
}

fn bind_workspace(state_path: &Path, workspace: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(workspace).map_err(|e| format!("Project unavailable: {e}"))?;
    if !root.is_dir() {
        return Err("Project is not a directory".into());
    }
    let state: serde_json::Value =
        serde_json::from_slice(&fs::read(state_path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let active = state
        .get("lastWorkspace")
        .and_then(|value| value.as_str())
        .ok_or("No active project")?;
    if fs::canonicalize(active).map_err(|e| e.to_string())? != root {
        return Err("Git operations are limited to the active project".into());
    }
    Ok(root)
}

fn repository(root: &Path) -> Result<bool, String> {
    let metadata = match fs::symlink_metadata(root.join(".git")) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.to_string()),
    };
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(
            "Redirected or linked-worktree Git metadata is not supported by this panel".into(),
        );
    }
    let git_dir = fs::canonicalize(root.join(".git")).map_err(|e| e.to_string())?;
    if git_dir.parent() != Some(fs::canonicalize(root).map_err(|e| e.to_string())?.as_path()) {
        return Err("Git metadata escapes the project".into());
    }
    for name in ["index", "HEAD", "config", "objects", "refs", "logs"] {
        let path = git_dir.join(name);
        if let Ok(metadata) = fs::symlink_metadata(&path) {
            if metadata.file_type().is_symlink()
                || !fs::canonicalize(path)
                    .map_err(|e| e.to_string())?
                    .starts_with(&git_dir)
            {
                return Err("Symlinked Git metadata is not supported".into());
            }
        }
    }
    if git_dir.join("commondir").exists() {
        return Err("Shared Git metadata is not supported".into());
    }
    let output = checked(root, &["rev-parse", "--show-toplevel"])?;
    let top = std::str::from_utf8(&output.stdout)
        .map_err(|_| "Git returned a non-UTF-8 root")?
        .trim_end_matches(['\r', '\n']);
    if fs::canonicalize(top).map_err(|e| e.to_string())?
        != fs::canonicalize(root).map_err(|e| e.to_string())?
    {
        return Err("Repository root does not match the active project".into());
    }
    Ok(true)
}

fn require_repository(root: &Path) -> Result<(), String> {
    if !repository(root)? {
        return Err("This project has no Git repository".into());
    }
    Ok(())
}

fn parse_status(raw: &[u8]) -> Result<Vec<GitEntry>, String> {
    if !raw.is_empty() && !raw.ends_with(&[0]) {
        return Err("Incomplete Git status response".into());
    }
    let mut records = raw.split(|byte| *byte == 0).peekable();
    let mut entries = Vec::new();
    while let Some(record) = records.next() {
        if record.is_empty() && records.peek().is_none() {
            break;
        }
        if record.len() < 4 || record[2] != b' ' {
            return Err("Malformed Git status response".into());
        }
        let path = std::str::from_utf8(&record[3..])
            .map_err(|_| "Non-UTF-8 filenames cannot be shown safely")?
            .to_string();
        let original_path = if record[..2]
            .iter()
            .any(|byte| *byte == b'R' || *byte == b'C')
        {
            let previous = records
                .next()
                .filter(|record| !record.is_empty())
                .ok_or("Incomplete rename record")?;
            Some(
                std::str::from_utf8(previous)
                    .map_err(|_| "Non-UTF-8 rename path")?
                    .to_string(),
            )
        } else {
            None
        };
        entries.push(GitEntry {
            path,
            original_path,
            index_status: (record[0] as char).to_string(),
            worktree_status: (record[1] as char).to_string(),
        });
    }
    Ok(entries)
}

fn fingerprint(root: &Path) -> Result<String, String> {
    let mut hasher = DefaultHasher::new();
    // Read-only snapshot of index bytes; optional locks prevent status from rewriting it.
    match fs::File::open(root.join(".git/index")) {
        Ok(mut file) => {
            let mut chunk = [0; 8192];
            loop {
                let length = file.read(&mut chunk).map_err(|e| e.to_string())?;
                if length == 0 {
                    break;
                }
                hasher.write(&chunk[..length]);
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => "unborn".hash(&mut hasher),
        Err(error) => return Err(error.to_string()),
    }
    let head = git(root, &["rev-parse", "--verify", "HEAD"])?;
    head.stdout.hash(&mut hasher);
    Ok(format!("{:016x}", hasher.finish()))
}

fn recent_commits(root: &Path) -> Result<Vec<GitCommit>, String> {
    let head = git(root, &["rev-parse", "--verify", "HEAD"])?;
    if !head.success {
        return Ok(vec![]);
    }
    let log = checked(
        root,
        &[
            "log",
            "-n",
            "10",
            "--date=format:%Y-%m-%d %H:%M",
            "--format=%H\x1f%h\x1f%cd\x1f%s%x00",
        ],
    )?;
    let mut commits = Vec::new();
    for record in log.stdout.split(|byte| *byte == 0) {
        if record.is_empty() {
            continue;
        }
        let text = std::str::from_utf8(record)
            .map_err(|_| "Non-UTF-8 commit history")?
            .trim_start_matches(['\r', '\n']);
        let mut parts = text.splitn(4, '\x1f');
        if let (Some(hash), Some(short_hash), Some(timestamp), Some(subject)) = (
            parts.next(),
            parts.next(),
            parts.next(),
            parts.next(),
        ) {
            commits.push(GitCommit {
                hash: hash.to_string(),
                short_hash: short_hash.to_string(),
                timestamp: timestamp.to_string(),
                subject: subject.trim().to_string(),
            });
        }
    }
    Ok(commits)
}

fn status_in(root: &Path) -> Result<RepositoryStatus, String> {
    checked(root, &["--version"])?;
    if !repository(root)? {
        return Ok(RepositoryStatus {
            is_repository: false,
            branch: String::new(),
            entries: vec![],
            commits: vec![],
            index_fingerprint: String::new(),
        });
    }
    let index_fingerprint = fingerprint(root)?;
    let output = checked(
        root,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--ignore-submodules=all",
        ],
    )?;
    if output.truncated {
        return Err("Too many changes to display safely. Use an external Git client.".into());
    }
    let entries = parse_status(&output.stdout)?;
    let commits = recent_commits(root)?;
    let branch = git(root, &["symbolic-ref", "--quiet", "--short", "HEAD"])?;
    let branch = if branch.success {
        String::from_utf8_lossy(&branch.stdout).trim().to_string()
    } else {
        "Detached HEAD".into()
    };
    if fingerprint(root)? != index_fingerprint {
        return Err("The Git index changed while loading. Refresh to try again.".into());
    }
    Ok(RepositoryStatus {
        is_repository: true,
        branch,
        entries,
        commits,
        index_fingerprint,
    })
}

fn guard_path(root: &Path, path: &str) -> Result<(), String> {
    if path.is_empty()
        || path.contains(['\0', '\\', ':'])
        || path.split('/').any(|part| {
            part.is_empty() || part == "." || part == ".." || part.eq_ignore_ascii_case(".git")
        })
    {
        return Err("Unsafe Git file path".into());
    }
    if Path::new(path)
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("Git file path must be relative".into());
    }
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let mut current = root.clone();
    for part in Path::new(path).components() {
        current.push(part.as_os_str());
        match fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink()
                    || !fs::canonicalize(&current)
                        .map_err(|e| e.to_string())?
                        .starts_with(&root)
                {
                    return Err(
                        "Symlinked files and paths outside the project are not supported".into(),
                    );
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (), // Tracked deletion.
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

fn selected_entry(root: &Path, path: &str) -> Result<GitEntry, String> {
    guard_path(root, path)?;
    let entry = status_in(root)?
        .entries
        .into_iter()
        .find(|entry| entry.path == path)
        .ok_or("File is no longer listed as changed; refresh first")?;
    if let Some(original) = &entry.original_path {
        guard_path(root, original)?;
    }
    Ok(entry)
}

fn stage_in(root: &Path, path: &str) -> Result<(), String> {
    require_repository(root)?;
    let entry = selected_entry(root, path)?;
    let mut args = vec!["add", "--", path];
    if let Some(original) = &entry.original_path {
        // Staged rename sources have already left the index; adding them would fail.
        if entry.worktree_status == "R" {
            args.push(original);
        }
    }
    checked(root, &args)?;
    Ok(())
}

fn unstage_in(root: &Path, path: &str) -> Result<(), String> {
    require_repository(root)?;
    let entry = selected_entry(root, path)?;
    if [" ", "?", "!"].contains(&entry.index_status.as_str()) {
        return Err("File has no staged changes".into());
    }
    let head = git(root, &["rev-parse", "--verify", "HEAD"])?;
    let mut args = if head.success {
        vec!["restore", "--staged", "--source=HEAD", "--", path]
    } else {
        vec!["rm", "--cached", "--force", "--ignore-unmatch", "--", path]
    };
    if let Some(original) = &entry.original_path {
        args.push(original);
    }
    checked(root, &args)?;
    Ok(())
}

fn revert_in(root: &Path, path: &str) -> Result<(), String> {
    require_repository(root)?;
    let entry = selected_entry(root, path)?;
    if entry.index_status == "?" {
        let target = root.join(path);
        if target.exists() {
            fs::remove_file(&target).map_err(|e| format!("Could not remove untracked file: {e}"))?;
        }
        return Ok(());
    }
    let head = git(root, &["rev-parse", "--verify", "HEAD"])?;
    if !head.success || entry.index_status == "A" {
        checked(root, &["rm", "--cached", "--force", "--ignore-unmatch", "--", path])?;
        let target = root.join(path);
        if target.exists() {
            fs::remove_file(&target).map_err(|e| format!("Could not remove file: {e}"))?;
        }
        return Ok(());
    }
    if entry.index_status == "R" {
        let target = root.join(path);
        if target.exists() {
            fs::remove_file(&target).map_err(|e| format!("Could not remove renamed file: {e}"))?;
        }
    }
    let mut args = vec!["restore", "--staged", "--worktree", "--source=HEAD", "--", path];
    if let Some(original) = &entry.original_path {
        args.push(original);
    }
    checked(root, &args)?;
    Ok(())
}

fn diff_in(root: &Path, path: &str, staged: bool) -> Result<GitDiff, String> {
    require_repository(root)?;
    let entry = selected_entry(root, path)?;
    if entry.index_status == "?" {
        if staged {
            return Err("Untracked files have no staged diff".into());
        }
        let file = fs::File::open(root.join(path)).map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        file.take((OUTPUT_LIMIT + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        let truncated = bytes.len() > OUTPUT_LIMIT;
        bytes.truncate(OUTPUT_LIMIT);
        let binary = bytes.contains(&0) || std::str::from_utf8(&bytes).is_err();
        let text = if binary {
            String::new()
        } else {
            format!(
                "New file: {path}\n{}",
                String::from_utf8_lossy(&bytes)
                    .lines()
                    .map(|line| format!("+{line}\n"))
                    .collect::<String>()
            )
        };
        return Ok(GitDiff {
            text,
            binary,
            truncated,
        });
    }
    let mut args = vec![
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--ignore-submodules=all",
    ];
    if staged {
        args.push("--cached");
    }
    args.extend(["--", path]);
    if let Some(original) = &entry.original_path {
        args.push(original);
    }
    let output = checked(root, &args)?;
    let text = String::from_utf8_lossy(&output.stdout).into_owned();
    let binary = output.stdout.contains(&0)
        || text
            .lines()
            .any(|line| line.starts_with("Binary files ") || line == "GIT binary patch");
    Ok(GitDiff {
        text,
        binary,
        truncated: output.truncated,
    })
}

fn commit_in(root: &Path, message: &str, expected_index: &str) -> Result<(), String> {
    require_repository(root)?;
    if message.trim().is_empty() || message.len() > 4096 || message.contains('\0') {
        return Err("Provide a commit message of 1–4096 bytes".into());
    }
    if fingerprint(root)? != expected_index {
        return Err(
            "Staged changes changed since the last refresh. Review them again before committing."
                .into(),
        );
    }
    for marker in [
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "rebase-apply",
        "rebase-merge",
        "sequencer",
    ] {
        if root.join(".git").join(marker).exists() {
            return Err("Finish the in-progress Git operation in an external client before committing here.".into());
        }
    }
    let status = status_in(root)?;
    if !status
        .entries
        .iter()
        .any(|entry| ![" ", "?", "!"].contains(&entry.index_status.as_str()))
    {
        if status.entries.is_empty() {
            return Err("No changes to save.".into());
        }
        return auto_commit_in(root, message).map(|_| ());
    }
    // Git commit can rewrite the index tree cache before discovering a missing identity.
    // Validate both identities first so this rejection leaves the index byte-for-byte intact.
    checked(root, &["var", "GIT_AUTHOR_IDENT"])?;
    checked(root, &["var", "GIT_COMMITTER_IDENT"])?;
    if fingerprint(root)? != expected_index {
        return Err("Staged changes changed before commit. Refresh and review them again.".into());
    }
    // No -a and no path arguments: Git commits the staged index, never current file contents.
    checked(
        root,
        &[
            "commit",
            "--no-gpg-sign",
            "--no-verify",
            "--cleanup=verbatim",
            "--message",
            message,
        ],
    )?;
    Ok(())
}

fn init_in(root: &Path) -> Result<(), String> {
    if repository(root)? {
        return Err("This project already has a Git repository".into());
    }
    let enclosing = git(root, &["rev-parse", "--absolute-git-dir"])?;
    if enclosing.success {
        return Err("This folder belongs to an enclosing or bare repository. Open its working-tree root or choose a project outside it.".into());
    }
    // Empty template prevents init from copying executable template hooks into the project.
    checked(root, &["init", "--template="])?;
    Ok(())
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AutoCommitResult {
    Committed,
    IndexUpdated,
    Unchanged,
    NoRepository,
    GitUnavailable,
}

fn auto_commit_outcome(result: Result<AutoCommitResult, String>) -> Result<AutoCommitResult, String> {
    match result {
        Err(error) if error == git_start_error(std::io::Error::from(std::io::ErrorKind::NotFound)) => {
            Ok(AutoCommitResult::GitUnavailable)
        }
        other => other,
    }
}

fn auto_commit_in(root: &Path, message: &str) -> Result<AutoCommitResult, String> {
    auto_commit_outcome((|| {
        let status = status_in(root)?;
        if !status.is_repository { return Ok(AutoCommitResult::NoRepository); }
        if status.entries.is_empty() { return Ok(AutoCommitResult::Unchanged); }
        // Reject predictable failures before changing the user's staged index.
        if message.trim().is_empty() || message.len() > 4096 || message.contains('\0') {
            return Err("Provide a commit message of 1–4096 bytes".into());
        }
        for marker in ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-apply", "rebase-merge", "sequencer"] {
            if root.join(".git").join(marker).exists() {
                return Err("Finish the in-progress Git operation in an external client before committing here.".into());
            }
        }
        for entry in &status.entries {
            if entry.index_status == "U" || entry.worktree_status == "U"
                || (entry.index_status == "A" && entry.worktree_status == "A")
                || (entry.index_status == "D" && entry.worktree_status == "D") {
                return Err("Resolve Git conflicts before automatic commits can run.".into());
            }
            guard_path(root, &entry.path)?;
            if let Some(original) = &entry.original_path { guard_path(root, original)?; }
        }
        checked(root, &["var", "GIT_AUTHOR_IDENT"])?;
        checked(root, &["var", "GIT_COMMITTER_IDENT"])?;
        if fingerprint(root)? != status.index_fingerprint {
            return Err("The Git index changed before automatic staging. Try again later.".into());
        }
        checked(root, &["add", "--", "."])?;
        let staged = status_in(root)?;
        // A staged edit can cancel a worktree edit, leaving no commit to create.
        if !staged.entries.iter().any(|entry| ![" ", "?", "!"].contains(&entry.index_status.as_str())) {
            return Ok(AutoCommitResult::IndexUpdated);
        }
        commit_in(root, message, &staged.index_fingerprint)?;
        Ok(AutoCommitResult::Committed)
    })())
}

async fn in_project<T: Send + 'static>(
    app: AppHandle,
    workspace: String,
    work: impl FnOnce(&Path) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let state = crate::config_root::path(&app)?
        .join(crate::config::STATE_FILE);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = OPERATIONS
            .lock()
            .map_err(|_| "Git operation lock unavailable")?;
        let root = bind_workspace(&state, &workspace)?;
        work(&root)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_status(app: AppHandle, workspace: String) -> Result<RepositoryStatus, String> {
    in_project(app, workspace, status_in).await
}

#[tauri::command]
pub async fn git_diff(
    app: AppHandle,
    workspace: String,
    path: String,
    staged: bool,
) -> Result<GitDiff, String> {
    in_project(app, workspace, move |root| diff_in(root, &path, staged)).await
}

#[tauri::command]
pub async fn git_stage(app: AppHandle, workspace: String, path: String) -> Result<(), String> {
    in_project(app, workspace, move |root| stage_in(root, &path)).await
}

#[tauri::command]
pub async fn git_unstage(app: AppHandle, workspace: String, path: String) -> Result<(), String> {
    in_project(app, workspace, move |root| unstage_in(root, &path)).await
}

fn commit_diff_in(root: &Path, commit: &str, path: Option<&str>) -> Result<GitDiff, String> {
    require_repository(root)?;
    if commit.len() < 7
        || commit.len() > 40
        || !commit.chars().all(|c| c.is_ascii_hexdigit())
    {
        return Err("Invalid commit identifier".into());
    }
    checked(root, &["rev-parse", "--verify", &format!("{commit}^{{commit}}")])?;
    let _args = vec![
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--ignore-submodules=all",
        "--no-renames",
    ];
    let _ = [
        "show",
        "--format=",
        "--root",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--ignore-submodules=all",
        "--no-renames",
        commit,
    ];
    let mut args = vec![
        "show",
        "--format=",
        "--root",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--ignore-submodules=all",
        "--no-renames",
        commit,
    ];
    if let Some(rel) = path {
        guard_path(root, rel)?;
        args.extend(["--", rel]);
    }
    let output = checked(root, &args)?;
    let text = String::from_utf8_lossy(&output.stdout).into_owned();
    let binary = output.stdout.contains(&0)
        || text
            .lines()
            .any(|line| line.starts_with("Binary files ") || line == "GIT binary patch");
    Ok(GitDiff {
        text,
        binary,
        truncated: output.truncated,
    })
}

#[tauri::command]
pub async fn git_commit_diff(
    app: AppHandle,
    workspace: String,
    commit: String,
    path: Option<String>,
) -> Result<GitDiff, String> {
    in_project(app, workspace, move |root| {
        commit_diff_in(root, &commit, path.as_deref())
    })
    .await
}

fn rollback_in(root: &Path, commit: &str, path: Option<&str>) -> Result<(), String> {
    require_repository(root)?;
    if commit.len() < 7
        || commit.len() > 40
        || !commit.chars().all(|c| c.is_ascii_hexdigit())
    {
        return Err("Invalid commit identifier".into());
    }
    checked(root, &["rev-parse", "--verify", &format!("{commit}^{{commit}}")])?;
    let source = format!("--source={commit}");
    match path {
        Some(rel) => {
            guard_path(root, rel)?;
            checked(root, &["restore", "--staged", "--worktree", &source, "--", rel])?;
        }
        None => {
            checked(root, &["restore", "--staged", "--worktree", &source, "--", "."])?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn git_revert(app: AppHandle, workspace: String, path: String) -> Result<(), String> {
    in_project(app, workspace, move |root| revert_in(root, &path)).await
}

#[tauri::command]
pub async fn git_rollback(
    app: AppHandle,
    workspace: String,
    commit: String,
    path: Option<String>,
) -> Result<(), String> {
    in_project(app, workspace, move |root| {
        rollback_in(root, &commit, path.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn git_commit(
    app: AppHandle,
    workspace: String,
    message: String,
    expected_index: String,
) -> Result<(), String> {
    in_project(app, workspace, move |root| {
        commit_in(root, &message, &expected_index)
    })
    .await
}

#[tauri::command]
pub async fn git_init(app: AppHandle, workspace: String) -> Result<(), String> {
    in_project(app, workspace, init_in).await
}

#[tauri::command]
pub async fn git_auto_commit(app: AppHandle, workspace: String, message: String) -> Result<AutoCommitResult, String> {
    in_project(app, workspace, move |root| auto_commit_in(root, &message)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT: AtomicUsize = AtomicUsize::new(0);

    #[test]
    fn auto_commit_missing_git_skips_but_other_failures_propagate() {
        assert_eq!(auto_commit_outcome(Err(git_start_error(std::io::Error::from(std::io::ErrorKind::NotFound)))).unwrap(), AutoCommitResult::GitUnavailable);
        assert!(auto_commit_outcome(Err(git_start_error(std::io::Error::from(std::io::ErrorKind::PermissionDenied)))).is_err());
    }

    #[test]
    fn auto_commit_stages_saved_changes_and_skips_clean_or_non_repository() {
        let root = repo("auto");
        fs::write(root.join("keep.md"), "old\n").unwrap();
        fs::write(root.join("delete.md"), "old\n").unwrap();
        raw(&root, &["add", "."]);
        raw(&root, &["commit", "-m", "Initial"]);
        fs::write(root.join("keep.md"), "new\n").unwrap();
        fs::remove_file(root.join("delete.md")).unwrap();
        fs::write(root.join("new.md"), "new page\n").unwrap();
        fs::write(root.join(".gitignore"), "ignored.txt\n").unwrap();
        fs::write(root.join("ignored.txt"), "private\n").unwrap();
        assert_eq!(auto_commit_in(&root, "Automatic update").unwrap(), AutoCommitResult::Committed);
        assert_eq!(raw(&root, &["show", "HEAD:keep.md"]), "new\n");
        assert_eq!(raw(&root, &["show", "HEAD:new.md"]), "new page\n");
        let files = raw(&root, &["ls-tree", "--name-only", "HEAD"]);
        assert!(!files.contains("delete.md"));
        assert!(!files.contains("ignored.txt"));
        assert_eq!(raw(&root, &["log", "-1", "--format=%s"]).trim(), "Automatic update");
        assert_eq!(auto_commit_in(&root, "Again").unwrap(), AutoCommitResult::Unchanged);
        fs::write(root.join("keep.md"), "staged edit\n").unwrap();
        raw(&root, &["add", "."]);
        fs::write(root.join("keep.md"), "new\n").unwrap();
        assert_eq!(auto_commit_in(&root, "Cancelled edit").unwrap(), AutoCommitResult::IndexUpdated);
        assert_eq!(raw(&root, &["log", "-1", "--format=%s"]).trim(), "Automatic update");
        let empty = scratch("auto-no-repo");
        assert_eq!(auto_commit_in(&empty, "Update").unwrap(), AutoCommitResult::NoRepository);
        assert!(!empty.join(".git").exists());
    }

    #[test]
    fn auto_commit_rejections_do_not_stage_files() {
        let root = repo("auto-reject");
        fs::write(root.join("a.md"), "first\n").unwrap();
        raw(&root, &["add", "."]);
        let index = fs::read(root.join(".git/index")).unwrap();
        fs::write(root.join("a.md"), "later\n").unwrap();
        assert!(auto_commit_in(&root, " ").is_err());
        fs::write(root.join(".git/MERGE_HEAD"), "pending").unwrap();
        assert!(auto_commit_in(&root, "Update").is_err());
        fs::remove_file(root.join(".git/MERGE_HEAD")).unwrap();
        raw(&root, &["config", "user.name", ""]);
        raw(&root, &["config", "user.email", ""]);
        assert!(auto_commit_in(&root, "Update").is_err());
        assert_eq!(fs::read(root.join(".git/index")).unwrap(), index);
        assert_eq!(raw(&root, &["show", ":a.md"]), "first\n");
    }

    #[test]
    fn missing_git_explains_the_requirement_and_official_download() {
        assert_eq!(
            git_start_error(std::io::Error::from(std::io::ErrorKind::NotFound)),
            "Source Control requires Git. Please download it from https://git-scm.com/install/."
        );
        let denied = git_start_error(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "Access denied",
        ));
        assert_eq!(denied, "Could not start Git: Access denied");
        assert!(!denied.contains("download"));
    }

    fn scratch(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "grimoire-git-{label}-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed),
        ));
        fs::create_dir_all(&root).unwrap();
        println!("Git test scratch: {}", root.display());
        root
    }

    fn raw(root: &Path, args: &[&str]) -> String {
        let result = Command::new("git")
            .arg("-C")
            .arg(root)
            .args([
                "-c",
                "core.hooksPath=/dev/null",
                "-c",
                "commit.gpgSign=false",
            ])
            .args(args)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        String::from_utf8(result.stdout).unwrap()
    }

    fn repo(label: &str) -> PathBuf {
        let root = scratch(label);
        raw(&root, &["init"]);
        raw(&root, &["config", "user.name", "Fixture Author"]);
        raw(&root, &["config", "user.email", "fixture@example.invalid"]);
        root
    }

    #[test]
    fn porcelain_preserves_rename_unicode_spaces_and_deletion() {
        let entries =
            parse_status(b"R  new \xc3\xb1ame.md\0old name.md\0 D gone.md\0?? space name.md\0")
                .unwrap();
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].path, "new ñame.md");
        assert_eq!(entries[0].original_path.as_deref(), Some("old name.md"));
        assert_eq!(entries[1].worktree_status, "D");
        assert_eq!(entries[2].index_status, "?");
        assert!(parse_status(b"R  missing-source\0").is_err());
    }

    #[test]
    fn stage_unstage_and_commit_only_the_index_not_unsaved_worktree() {
        let root = repo("staging");
        fs::write(root.join("chapter ü.md"), "staged version\n").unwrap();
        fs::write(root.join("unrelated.md"), "leave untracked\n").unwrap();
        stage_in(&root, "chapter ü.md").unwrap();
        unstage_in(&root, "chapter ü.md").unwrap();
        assert!(raw(&root, &["ls-files"]).is_empty());
        stage_in(&root, "chapter ü.md").unwrap();
        let status = status_in(&root).unwrap();
        fs::write(root.join("chapter ü.md"), "later unstaged version\n").unwrap();
        commit_in(&root, "Write chapter", &status.index_fingerprint).unwrap();
        assert_eq!(
            raw(&root, &["show", "HEAD:chapter ü.md"]),
            "staged version\n"
        );
        assert_eq!(
            raw(&root, &["ls-tree", "--name-only", "HEAD"]).trim(),
            "\"chapter \\303\\274.md\""
        );
        assert_eq!(
            fs::read_to_string(root.join("chapter ü.md")).unwrap(),
            "later unstaged version\n"
        );
        assert_eq!(
            fs::read_to_string(root.join("unrelated.md")).unwrap(),
            "leave untracked\n"
        );
    }

    #[test]
    fn rename_and_delete_can_be_unstaged_without_restoring_worktree_files() {
        let root = repo("rename");
        fs::write(root.join("old name.md"), "chapter\n").unwrap();
        stage_in(&root, "old name.md").unwrap();
        commit_in(
            &root,
            "Initial",
            &status_in(&root).unwrap().index_fingerprint,
        )
        .unwrap();
        fs::rename(root.join("old name.md"), root.join("new ñame.md")).unwrap();
        stage_in(&root, "old name.md").unwrap();
        stage_in(&root, "new ñame.md").unwrap();
        assert_eq!(
            status_in(&root).unwrap().entries[0]
                .original_path
                .as_deref(),
            Some("old name.md")
        );
        unstage_in(&root, "new ñame.md").unwrap();
        assert_eq!(raw(&root, &["diff", "--cached"]), "");
        assert!(!root.join("old name.md").exists());
        assert!(root.join("new ñame.md").exists());
    }

    #[test]
    fn revert_restores_tracked_changes_and_removes_untracked_or_newly_staged_files() {
        let root = repo("revert");
        fs::write(root.join("tracked.md"), "original\n").unwrap();
        stage_in(&root, "tracked.md").unwrap();
        commit_in(&root, "Initial", &status_in(&root).unwrap().index_fingerprint).unwrap();

        fs::write(root.join("tracked.md"), "modified\n").unwrap();
        stage_in(&root, "tracked.md").unwrap();
        revert_in(&root, "tracked.md").unwrap();
        assert_eq!(fs::read_to_string(root.join("tracked.md")).unwrap().replace("\r\n", "\n"), "original\n");
        assert!(status_in(&root).unwrap().entries.is_empty());

        fs::write(root.join("untracked.md"), "scratch\n").unwrap();
        revert_in(&root, "untracked.md").unwrap();
        assert!(!root.join("untracked.md").exists());

        fs::write(root.join("added.md"), "new staged\n").unwrap();
        stage_in(&root, "added.md").unwrap();
        revert_in(&root, "added.md").unwrap();
        assert!(!root.join("added.md").exists());
        assert!(status_in(&root).unwrap().entries.is_empty());
    }

    #[test]
    fn rejected_paths_and_stale_commits_leave_index_and_head_unchanged() {
        let root = repo("rejection");
        fs::write(root.join("chapter.md"), "chapter\n").unwrap();
        stage_in(&root, "chapter.md").unwrap();
        let index = fs::read(root.join(".git/index")).unwrap();
        let head = fs::read(root.join(".git/HEAD")).unwrap();
        for path in [
            "../outside.md",
            ".git/config",
            ":(glob)*",
            "/absolute.md",
            "chapter.md/../other",
        ] {
            assert!(stage_in(&root, path).is_err(), "accepted {path}");
        }
        assert!(commit_in(&root, "Stale", "outdated").is_err());
        assert_eq!(fs::read(root.join(".git/index")).unwrap(), index);
        assert_eq!(fs::read(root.join(".git/HEAD")).unwrap(), head);
    }

    #[test]
    fn nested_workspace_never_uses_parent_repository() {
        let root = repo("nested");
        let child = root.join("project");
        fs::create_dir(&child).unwrap();
        fs::write(child.join("chapter.md"), "chapter\n").unwrap();
        let head = fs::read(root.join(".git/HEAD")).unwrap();
        assert!(!status_in(&child).unwrap().is_repository);
        assert!(stage_in(&child, "chapter.md").is_err());
        assert!(init_in(&child).is_err());
        assert!(!root.join(".git/index").exists());
        assert_eq!(fs::read(root.join(".git/HEAD")).unwrap(), head);
    }

    #[test]
    fn active_workspace_binding_rejects_other_remembered_projects() {
        let root = scratch("active");
        let other = scratch("other");
        let state = root.join("state.json");
        fs::write(
            &state,
            serde_json::json!({"lastWorkspace": root, "recentWorkspaces": [root, other]})
                .to_string(),
        )
        .unwrap();
        assert!(bind_workspace(&state, &root.to_string_lossy()).is_ok());
        assert!(bind_workspace(&state, &other.to_string_lossy()).is_err());
    }

    #[test]
    fn text_binary_and_large_untracked_previews_are_bounded() {
        let root = repo("preview");
        fs::write(root.join("text.md"), "a line\n").unwrap();
        fs::write(root.join("binary.bin"), b"\0binary").unwrap();
        fs::write(root.join("large.md"), vec![b'a'; OUTPUT_LIMIT + 100]).unwrap();
        let text = diff_in(&root, "text.md", false).unwrap();
        assert!(text.text.contains("+a line"));
        assert!(!text.binary);
        assert!(diff_in(&root, "binary.bin", false).unwrap().binary);
        assert!(diff_in(&root, "large.md", false).unwrap().truncated);
        stage_in(&root, "text.md").unwrap();
        assert!(diff_in(&root, "text.md", true)
            .unwrap()
            .text
            .contains("+a line"));
    }

    #[test]
    fn project_helpers_hooks_filters_and_signing_are_not_executed() {
        let root = repo("helpers");
        let marker = root
            .join("helper-ran.txt")
            .to_string_lossy()
            .replace('\\', "/");
        let helper = format!("echo unsafe > '{marker}'; cat");
        raw(&root, &["config", "filter.unsafe.clean", &helper]);
        raw(&root, &["config", "filter.unsafe.required", "true"]);
        raw(&root, &["config", "diff.unsafe.command", &helper]);
        raw(&root, &["config", "diff.unsafe.textconv", &helper]);
        raw(&root, &["config", "core.fsmonitor", &helper]);
        raw(&root, &["config", "commit.gpgSign", "true"]);
        fs::write(
            root.join(".gitattributes"),
            "*.md filter=unsafe diff=unsafe\n",
        )
        .unwrap();
        fs::write(
            root.join(".git/hooks/pre-commit"),
            format!("#!/bin/sh\necho hook > '{marker}'\nexit 1\n"),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(
                root.join(".git/hooks/pre-commit"),
                fs::Permissions::from_mode(0o755),
            )
            .unwrap();
        }
        fs::write(root.join("chapter.md"), "plain text\n").unwrap();
        stage_in(&root, "chapter.md").unwrap();
        assert!(diff_in(&root, "chapter.md", true)
            .unwrap()
            .text
            .contains("plain text"));
        commit_in(
            &root,
            "Safe commit",
            &status_in(&root).unwrap().index_fingerprint,
        )
        .unwrap();
        assert!(!root.join("helper-ran.txt").exists());
    }

    #[test]
    fn missing_identity_is_an_error_and_does_not_change_the_index() {
        let root = repo("identity");
        raw(&root, &["config", "user.name", ""]);
        raw(&root, &["config", "user.email", ""]);
        raw(&root, &["config", "user.useConfigOnly", "true"]);
        fs::write(root.join("chapter.md"), "chapter\n").unwrap();
        stage_in(&root, "chapter.md").unwrap();
        let before = fs::read(root.join(".git/index")).unwrap();
        let error = commit_in(
            &root,
            "Commit",
            &status_in(&root).unwrap().index_fingerprint,
        )
        .unwrap_err();
        assert!(error.contains("Git failed"));
        assert_eq!(fs::read(root.join(".git/index")).unwrap(), before);
        assert!(
            !git(&root, &["rev-parse", "--verify", "HEAD"])
                .unwrap()
                .success
        );
    }

    #[test]
    fn redirected_metadata_is_rejected_without_touching_other_repository() {
        let root = repo("redirect-target");
        let other = scratch("redirect-source");
        fs::write(
            other.join(".git"),
            format!("gitdir: {}\n", root.join(".git").display()),
        )
        .unwrap();
        let head = fs::read(root.join(".git/HEAD")).unwrap();
        assert!(status_in(&other).is_err());
        assert!(init_in(&other).is_err());
        assert_eq!(fs::read(root.join(".git/HEAD")).unwrap(), head);
    }

    #[test]
    fn initialization_is_explicit_and_rejects_existing_and_bare_repositories() {
        let root = scratch("init");
        assert!(!status_in(&root).unwrap().is_repository);
        assert!(!root.join(".git").exists());
        init_in(&root).unwrap();
        assert!(status_in(&root).unwrap().is_repository);
        let head = fs::read(root.join(".git/HEAD")).unwrap();
        assert!(init_in(&root).is_err());
        assert_eq!(fs::read(root.join(".git/HEAD")).unwrap(), head);

        let bare = scratch("bare");
        raw(&bare, &["init", "--bare"]);
        let head = fs::read(bare.join("HEAD")).unwrap();
        assert!(init_in(&bare).is_err());
        assert_eq!(fs::read(bare.join("HEAD")).unwrap(), head);
        assert!(!bare.join(".git").exists());
    }
}
