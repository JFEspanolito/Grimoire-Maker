use std::fs;
use std::path::Path;
use tauri_plugin_fs::FsExt;

const MAX_DEPTH: usize = 128;

/// Recursively lists `.md` files under `root`, skipping dot-directories.
#[tauri::command]
pub async fn list_markdown_files(app: tauri::AppHandle, root: String) -> Result<Vec<String>, String> {
    let scope = app.fs_scope();
    tauri::async_runtime::spawn_blocking(move || {
        list_in(Path::new(&root), &|path| scope.is_allowed(path), MAX_DEPTH)
    }).await.map_err(|error| error.to_string())?
}

fn list_in(root: &Path, allowed: &impl Fn(&Path) -> bool, max_depth: usize) -> Result<Vec<String>, String> {
    if !allowed(root) {
        return Err("Forbidden Markdown search directory".into());
    }
    // Pin the root and its ancestors on Windows; reject linked roots on every platform.
    let mut locks = Vec::new();
    crate::safe_copy::lock_ancestors(root, &mut locks)?;
    let canonical_root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    if !allowed(&canonical_root) {
        return Err("Forbidden Markdown search directory".into());
    }
    let mut found = Vec::new();
    walk(root, &canonical_root, allowed, 0, max_depth, &mut found)?;
    found.sort();
    Ok(found)
}

fn walk(
    dir: &Path,
    root: &Path,
    allowed: &impl Fn(&Path) -> bool,
    depth: usize,
    max_depth: usize,
    out: &mut Vec<String>,
) -> Result<(), String> {
    if depth > max_depth {
        return Err("Markdown search exceeded the directory depth limit".into());
    }
    for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        let hidden = path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.starts_with('.'));
        if hidden || !allowed(&path) {
            continue;
        }
        let info = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if crate::safe_copy::reject_special(&info).is_err() {
            continue;
        }
        let canonical = fs::canonicalize(&path).map_err(|error| error.to_string())?;
        if !canonical.starts_with(root) || !allowed(&canonical) {
            continue;
        }
        if info.is_dir() {
            let _directory = crate::safe_copy::open_checked(&path, true)?;
            walk(&path, root, allowed, depth + 1, max_depth, out)?;
        } else if path.extension().is_some_and(|e| e == "md") {
            out.push(path.to_string_lossy().into_owned());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn scratch(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "grimoire-files-{tag}-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&base).unwrap();
        eprintln!("files scratch retained: {}", base.display());
        base
    }

    #[test]
    fn denied_root_is_rejected_before_filesystem_access() {
        let base = scratch("denied");
        assert!(list_in(&base.join("missing"), &|_| false, 128).unwrap_err().contains("Forbidden"));
    }

    #[test]
    fn scoped_listing_preserves_sorted_markdown_and_skips_hidden_and_denied_entries() {
        let base = scratch("scope");
        fs::create_dir_all(base.join("chapter")).unwrap();
        fs::create_dir_all(base.join("denied")).unwrap();
        fs::create_dir_all(base.join(".hidden")).unwrap();
        for name in ["z.md", "chapter/a.md", "denied/secret.md", ".hidden/secret.md", ".private.md", "note.txt", "upper.MD"] {
            fs::write(base.join(name), "# Notes").unwrap();
        }
        let denied = base.join("denied");
        let found = list_in(&base, &|path| !path.starts_with(&denied), 128).unwrap();
        let mut expected = vec![base.join("z.md").to_string_lossy().into_owned(), base.join("chapter").join("a.md").to_string_lossy().into_owned()];
        expected.sort();
        assert_eq!(found, expected);
    }

    #[test]
    fn depth_limit_is_bounded_without_dropping_files_at_the_limit() {
        let base = scratch("depth");
        fs::create_dir_all(base.join("a/b")).unwrap();
        fs::write(base.join("a/edge.md"), "# Edge").unwrap();
        assert!(list_in(&base, &|_| true, 1).unwrap_err().contains("depth"));
        fs::remove_dir(base.join("a/b")).unwrap();
        assert_eq!(list_in(&base, &|_| true, 1).unwrap(), vec![base.join("a").join("edge.md").to_string_lossy().into_owned()]);
    }

    #[test]
    fn directory_links_are_skipped_and_a_linked_root_is_rejected() {
        let base = scratch("links");
        let root = base.join("root");
        let outside = base.join("outside");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(root.join("keep.md"), "# Keep").unwrap();
        fs::write(outside.join("secret.md"), "# Secret").unwrap();
        link_dir(&outside, &root.join("escape"));
        link_dir(&root, &root.join("loop"));
        assert_eq!(list_in(&root, &|_| true, 128).unwrap(), vec![root.join("keep.md").to_string_lossy().into_owned()]);
        assert!(list_in(&root.join("escape"), &|_| true, 128).is_err());
    }

    #[cfg(unix)]
    fn link_dir(target: &Path, link: &Path) {
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    #[cfg(windows)]
    fn link_dir(target: &Path, link: &Path) {
        assert!(std::process::Command::new("cmd.exe")
            .args(["/C", "mklink", "/J"])
            .arg(link).arg(target).output().unwrap().status.success());
    }
}
