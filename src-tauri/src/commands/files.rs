use std::fs;
use std::path::Path;

/// Recursively lists `.md` files under `root`, skipping dot-directories.
#[tauri::command]
pub fn list_markdown_files(root: String) -> Result<Vec<String>, String> {
    let mut found = Vec::new();
    walk(Path::new(&root), &mut found).map_err(|e| e.to_string())?;
    found.sort();
    Ok(found)
}

fn walk(dir: &Path, out: &mut Vec<String>) -> std::io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let path = entry?.path();
        let hidden = path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.starts_with('.'));
        if hidden {
            continue;
        }
        if path.is_dir() {
            walk(&path, out)?;
        } else if path.extension().is_some_and(|e| e == "md") {
            out.push(path.to_string_lossy().into_owned());
        }
    }
    Ok(())
}
