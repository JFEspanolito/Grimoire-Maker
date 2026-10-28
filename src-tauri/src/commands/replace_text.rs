//! Transactional project-wide text replacement. It shares the bounded inventory, link
//! safety and rollback journal of the reference-rename transaction, without a rename step.
use super::rename_references::{
    clean_absolute, inventory_in, portable, replace_operation, run_transaction, transaction_dir,
    verify_root, CHANGES, DOCUMENT_LIMIT, TOTAL_LIMIT,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};
use tauri::AppHandle;
use tauri_plugin_fs::FsExt;

#[derive(Clone, Debug, Serialize)]
pub struct ProjectText {
    pub path: String,
    pub before: String,
}
#[derive(Clone, Debug, Deserialize)]
pub struct ProjectChange {
    pub path: String,
    pub before: String,
    pub after: String,
}

#[tauri::command]
pub async fn snapshot_project_texts(
    app: AppHandle,
    root: String,
) -> Result<Vec<ProjectText>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = CHANGES.lock().map_err(|e| e.to_string())?;
        let state = crate::config_root::path(&app)?.join(crate::config::STATE_FILE);
        snapshot_in(&state, Path::new(&root), &|path| {
            app.fs_scope().is_allowed(path)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// `known_paths` is the optional list of paths returned by the snapshot. When present, the
/// current document set must equal it, so a document created or removed meanwhile is refused.
#[tauri::command]
pub async fn commit_project_replace(
    app: AppHandle,
    root: String,
    changes: Vec<ProjectChange>,
    known_paths: Option<Vec<String>>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = CHANGES.lock().map_err(|e| e.to_string())?;
        let state = crate::config_root::path(&app)?.join(crate::config::STATE_FILE);
        commit_in(
            &state,
            Path::new(&root),
            changes,
            known_paths,
            &|path| app.fs_scope().is_allowed(path),
            &mut |_| Ok(()),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Hidden folders anywhere and the top-level Trash are not part of the project text.
fn skipped(root: &Path) -> impl Fn(&Path, &str) -> bool + '_ {
    move |path, name| {
        name.starts_with('.')
            || (name.eq_ignore_ascii_case("Trash") && path.parent() == Some(root))
    }
}

fn snapshot_in(
    state: &Path,
    root: &Path,
    allowed: &dyn Fn(&Path) -> bool,
) -> Result<Vec<ProjectText>, String> {
    let (root, mut locks) = verify_root(state, root, allowed)?;
    let skip = skipped(&root);
    let documents = inventory_in(&root, &mut locks, allowed, &skip)?;
    documents
        .into_iter()
        .map(|document| {
            Ok(ProjectText {
                path: portable(&document.path)?,
                before: document.before,
            })
        })
        .collect()
}

fn commit_in(
    state: &Path,
    root: &Path,
    changes: Vec<ProjectChange>,
    known_paths: Option<Vec<String>>,
    allowed: &dyn Fn(&Path) -> bool,
    checkpoint: &mut dyn FnMut(&str) -> Result<(), String>,
) -> Result<Vec<String>, String> {
    if changes.is_empty() {
        return Err("There are no replacements to apply".into());
    }
    // Pure input checks run before anything on disk is touched.
    let mut submitted = BTreeMap::new();
    let mut after_total = 0usize;
    for change in changes {
        if change.before.len() > DOCUMENT_LIMIT || change.after.len() > DOCUMENT_LIMIT {
            return Err("A document exceeds the 4 MiB replacement limit".into());
        }
        after_total += change.after.len();
        if after_total > TOTAL_LIMIT {
            return Err("The replacements exceed the 32 MiB total limit".into());
        }
        let path = Path::new(&change.path);
        clean_absolute(path)?;
        if !path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        {
            return Err(format!("Only Markdown documents can be replaced: {}", change.path));
        }
        if submitted.insert(portable(path)?, change).is_some() {
            return Err("The same document appears twice in the replacements".into());
        }
    }
    let (root, mut locks) = verify_root(state, root, allowed)?;
    let transaction = transaction_dir(&root);
    if fs::symlink_metadata(&transaction).is_ok() {
        return Err(format!("A replace recovery transaction remains at {}. Inspect journal.jsonl and backups before another replace; do not delete recovery data until files are reconciled.", transaction.display()));
    }
    let skip = skipped(&root);
    let snapshot = inventory_in(&root, &mut locks, allowed, &skip)?;
    if let Some(known) = known_paths {
        let known: BTreeSet<String> = known.into_iter().collect();
        let current = snapshot
            .iter()
            .map(|document| portable(&document.path))
            .collect::<Result<BTreeSet<_>, _>>()?;
        if known != current {
            return Err(
                "The project documents changed since the search (a file was added or removed). Search again."
                    .into(),
            );
        }
    }
    let mut operations = Vec::new();
    let mut written = Vec::new();
    let mut found = 0usize;
    for document in &snapshot {
        let key = portable(&document.path)?;
        let Some(change) = submitted.get(&key) else {
            continue;
        };
        found += 1;
        if change.before != document.before {
            return Err(format!("A document changed since the search: {key}. Search again."));
        }
        if change.before == change.after {
            continue;
        }
        operations.push(replace_operation(
            &transaction,
            operations.len(),
            &document.path,
            &change.before,
            &change.after,
        ));
        written.push(key);
    }
    if found != submitted.len() {
        return Err("A document to replace is missing, hidden, or not part of the project. Search again.".into());
    }
    if operations.is_empty() {
        return Ok(written);
    }
    if !allowed(&transaction) {
        return Err("Replace transaction directory is outside granted scope".into());
    }
    run_transaction(&transaction, operations, snapshot, checkpoint, "Replace")?;
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    struct Fixture {
        base: PathBuf,
        root: PathBuf,
        state: PathBuf,
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            // Cleanup is best effort: Windows may still hold a handle for a moment.
            let _ = fs::remove_dir_all(&self.base);
        }
    }
    fn fixture() -> Fixture {
        let base = std::env::temp_dir().join(format!(
            "grimoire-replace-tests-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let root = base.join("project");
        for dir in ["Draft/sub", "Research", "Trash", ".hidden", "Draft/.cache"] {
            fs::create_dir_all(root.join(dir)).unwrap();
        }
        fs::write(root.join("top.md"), "alpha top\n").unwrap();
        fs::write(root.join("Draft/one.md"), "alpha one\r\n").unwrap();
        fs::write(root.join("Draft/sub/deep.MD"), "alpha deep\n").unwrap();
        fs::write(root.join("Research/r.md"), "alpha research\n").unwrap();
        fs::write(root.join("Trash/old.md"), "alpha trash\n").unwrap();
        fs::write(root.join(".hidden/h.md"), "alpha hidden\n").unwrap();
        fs::write(root.join("Draft/.cache/c.md"), "alpha cache\n").unwrap();
        fs::write(root.join("image.png"), b"alpha png").unwrap();
        let state = base.join("state.json");
        fs::write(&state, serde_json::json!({"lastWorkspace":root.to_str().unwrap(),"recentWorkspaces":[root.to_str().unwrap()]}).to_string()).unwrap();
        Fixture { base, root, state }
    }
    fn snapshot(f: &Fixture) -> Vec<ProjectText> {
        snapshot_in(&f.state, &f.root, &|_| true).unwrap()
    }
    fn plan(f: &Fixture) -> Vec<ProjectChange> {
        snapshot(f)
            .into_iter()
            .map(|d| ProjectChange {
                path: d.path,
                after: d.before.replace("alpha", "beta"),
                before: d.before,
            })
            .collect()
    }
    fn paths(f: &Fixture) -> Vec<String> {
        snapshot(f).into_iter().map(|d| d.path).collect()
    }
    fn apply(f: &Fixture, changes: Vec<ProjectChange>) -> Result<Vec<String>, String> {
        commit_in(&f.state, &f.root, changes, None, &|_| true, &mut |_| Ok(()))
    }
    fn apply_with(
        f: &Fixture,
        changes: Vec<ProjectChange>,
        hook: &mut dyn FnMut(&str) -> Result<(), String>,
    ) -> Result<Vec<String>, String> {
        commit_in(&f.state, &f.root, changes, None, &|_| true, hook)
    }
    fn read(f: &Fixture, name: &str) -> Vec<u8> {
        fs::read(f.root.join(name)).unwrap()
    }
    fn assert_originals(f: &Fixture) {
        assert_eq!(read(f, "top.md"), b"alpha top\n");
        assert_eq!(read(f, "Draft/one.md"), b"alpha one\r\n");
        assert_eq!(read(f, "Draft/sub/deep.MD"), b"alpha deep\n");
        assert_eq!(read(f, "Research/r.md"), b"alpha research\n");
        assert!(!f.root.join(".grimoire-rename-transaction").exists());
    }

    #[test]
    fn snapshot_excludes_trash_hidden_folders_and_other_files() {
        let f = fixture();
        let list = paths(&f);
        assert_eq!(list.len(), 4);
        assert!(list.iter().all(|p| !p.contains("Trash")
            && !p.contains(".hidden")
            && !p.contains(".cache")
            && !p.ends_with(".png")));
    }

    #[test]
    fn commits_several_files_including_nested_folders() {
        let f = fixture();
        let written = apply(&f, plan(&f)).unwrap();
        assert_eq!(written.len(), 4);
        assert_eq!(read(&f, "top.md"), b"beta top\n");
        assert_eq!(read(&f, "Draft/one.md"), b"beta one\r\n");
        assert_eq!(read(&f, "Draft/sub/deep.MD"), b"beta deep\n");
        assert_eq!(read(&f, "Research/r.md"), b"beta research\n");
        // Excluded files are untouched and no recovery data remains.
        assert_eq!(read(&f, "Trash/old.md"), b"alpha trash\n");
        assert_eq!(read(&f, ".hidden/h.md"), b"alpha hidden\n");
        assert!(!f.root.join(".grimoire-rename-transaction").exists());
    }

    #[test]
    fn unchanged_files_are_skipped_and_not_reported() {
        let f = fixture();
        let mut changes = plan(&f);
        for change in &mut changes {
            if change.path.ends_with("top.md") {
                change.after = change.before.clone();
            }
        }
        let written = apply(&f, changes).unwrap();
        assert_eq!(written.len(), 3);
        assert!(!written.iter().any(|p| p.ends_with("top.md")));
        assert_eq!(read(&f, "top.md"), b"alpha top\n");
        // Every change identical to its original performs no write at all.
        let same: Vec<_> = snapshot(&f)
            .into_iter()
            .map(|d| ProjectChange { path: d.path, after: d.before.clone(), before: d.before })
            .collect();
        assert!(apply(&f, same).unwrap().is_empty());
    }

    #[test]
    fn file_changed_since_snapshot_is_rejected_with_nothing_written() {
        let f = fixture();
        let changes = plan(&f);
        fs::write(f.root.join("Draft/one.md"), "external edit").unwrap();
        let error = apply(&f, changes).unwrap_err();
        assert!(error.contains("changed since the search"), "{error}");
        assert_eq!(read(&f, "Draft/one.md"), b"external edit");
        assert_eq!(read(&f, "top.md"), b"alpha top\n");
        assert_eq!(read(&f, "Research/r.md"), b"alpha research\n");
    }

    #[test]
    fn added_or_removed_documents_are_rejected_when_the_file_set_is_known() {
        let f = fixture();
        let known = paths(&f);
        let changes = plan(&f);
        fs::write(f.root.join("new.md"), "alpha new").unwrap();
        let error = commit_in(&f.state, &f.root, changes.clone(), Some(known.clone()), &|_| true, &mut |_| Ok(())).unwrap_err();
        assert!(error.contains("added or removed"), "{error}");
        assert_originals(&f);
        fs::remove_file(f.root.join("new.md")).unwrap();
        fs::remove_file(f.root.join("top.md")).unwrap();
        let error = commit_in(&f.state, &f.root, changes.clone(), Some(known), &|_| true, &mut |_| Ok(())).unwrap_err();
        assert!(error.contains("added or removed"), "{error}");
        assert_eq!(read(&f, "Draft/one.md"), b"alpha one\r\n");
        // Without the known list a removed changed file is still refused.
        assert!(apply(&f, changes).unwrap_err().contains("missing"));
        assert_eq!(read(&f, "Draft/one.md"), b"alpha one\r\n");
    }

    #[test]
    fn injected_failures_restore_every_original() {
        for failure in ["before-stage", "after-backup", "before-finalize", "before-publish"] {
            let f = fixture();
            let error = apply_with(&f, plan(&f), &mut |point| {
                if point == failure { Err("injected failure".into()) } else { Ok(()) }
            })
            .unwrap_err();
            assert!(error.contains("original files restored"), "{failure}: {error}");
            assert_originals(&f);
        }
    }

    #[test]
    fn partial_publication_is_rolled_back() {
        let f = fixture();
        let mut count = 0;
        let error = apply_with(&f, plan(&f), &mut |point| {
            if point == "after-publish" {
                count += 1;
                if count == 3 {
                    return Err("injected publication failure".into());
                }
            }
            Ok(())
        })
        .unwrap_err();
        assert!(error.contains("injected publication failure"));
        assert_originals(&f);
    }

    #[test]
    fn interrupted_transaction_keeps_backups_and_blocks_a_retry() {
        let f = fixture();
        let error = apply_with(&f, plan(&f), &mut |point| {
            if point == "after-backup" || point == "before-rollback" {
                Err("injected failure".into())
            } else {
                Ok(())
            }
        })
        .unwrap_err();
        assert!(error.contains("Rollback incomplete"), "{error}");
        let recovery = f.root.join(".grimoire-rename-transaction");
        assert!(recovery.join("journal.jsonl").exists());
        assert!(recovery.join("0.backup").exists());
        let retry = apply(&f, plan_after_interruption(&f)).unwrap_err();
        assert!(retry.contains("recovery transaction remains"), "{retry}");
    }
    fn plan_after_interruption(f: &Fixture) -> Vec<ProjectChange> {
        vec![ProjectChange {
            path: portable(&f.root.join("Research/r.md")).unwrap(),
            before: "alpha research\n".into(),
            after: "beta research\n".into(),
        }]
    }

    #[test]
    fn rollback_never_overwrites_a_concurrent_edit() {
        let f = fixture();
        let target = f.root.join("top.md");
        let error = apply_with(&f, plan(&f), &mut |point| {
            if point == "after-publish" && fs::read(&target).map(|b| b == b"beta top\n").unwrap_or(false) {
                fs::write(&target, b"external edit").unwrap();
                return Err("injected failure".into());
            }
            Ok(())
        })
        .unwrap_err();
        assert!(error.contains("Rollback incomplete"), "{error}");
        assert_eq!(fs::read(&target).unwrap(), b"external edit");
    }

    #[test]
    fn hard_linked_markdown_is_refused() {
        let f = fixture();
        fs::hard_link(f.root.join("top.md"), f.root.join("alias.md")).unwrap();
        assert!(snapshot_in(&f.state, &f.root, &|_| true).is_err());
        let changes = vec![ProjectChange {
            path: portable(&f.root.join("top.md")).unwrap(),
            before: "alpha top\n".into(),
            after: "beta top\n".into(),
        }];
        assert!(apply(&f, changes).is_err());
        assert_eq!(read(&f, "top.md"), b"alpha top\n");
    }

    #[test]
    fn linked_folders_are_refused() {
        let f = fixture();
        let outside = f.base.join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("secret.md"), "alpha secret").unwrap();
        let link = f.root.join("Draft/link");
        #[cfg(windows)]
        let linked = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&outside)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        #[cfg(unix)]
        let linked = std::os::unix::fs::symlink(&outside, &link).is_ok();
        if !linked {
            return;
        }
        assert!(snapshot_in(&f.state, &f.root, &|_| true).is_err());
        let changes = vec![ProjectChange {
            path: portable(&f.root.join("top.md")).unwrap(),
            before: "alpha top\n".into(),
            after: "beta top\n".into(),
        }];
        assert!(apply(&f, changes).is_err());
        assert_eq!(read(&f, "top.md"), b"alpha top\n");
        assert_eq!(fs::read(outside.join("secret.md")).unwrap(), b"alpha secret");
    }

    #[test]
    fn traversal_non_markdown_and_foreign_paths_are_refused() {
        let f = fixture();
        fs::write(f.base.join("outside.md"), "alpha outside").unwrap();
        let one = |path: String, before: &str| {
            vec![ProjectChange { path, before: before.into(), after: "beta".into() }]
        };
        let root = portable(&f.root).unwrap();
        for (path, before) in [
            (format!("{root}/../outside.md"), "alpha outside"),
            (portable(&f.base.join("outside.md")).unwrap(), "alpha outside"),
            (format!("{root}/image.png"), "alpha png"),
            (format!("{root}/Trash/old.md"), "alpha trash\n"),
            (format!("{root}/.hidden/h.md"), "alpha hidden\n"),
            (format!("{root}/nope.md"), "x"),
            ("relative.md".to_string(), "x"),
        ] {
            assert!(apply(&f, one(path.clone(), before)).is_err(), "{path}");
        }
        assert_eq!(fs::read(f.base.join("outside.md")).unwrap(), b"alpha outside");
        assert_eq!(read(&f, "image.png"), b"alpha png");
        assert_eq!(read(&f, "Trash/old.md"), b"alpha trash\n");
        assert_eq!(read(&f, ".hidden/h.md"), b"alpha hidden\n");
    }

    #[test]
    fn size_limits_duplicates_and_empty_lists_are_refused() {
        let f = fixture();
        assert!(apply(&f, vec![]).unwrap_err().contains("no replacements"));
        let mut changes = plan(&f);
        let duplicate = changes[0].clone();
        changes.push(duplicate);
        assert!(apply(&f, changes).unwrap_err().contains("twice"));
        let mut changes = plan(&f);
        changes[0].after = "a".repeat(DOCUMENT_LIMIT + 1);
        assert!(apply(&f, changes).unwrap_err().contains("4 MiB"));
        assert_originals(&f);
        // Nine documents just under the per-document limit exceed the 32 MiB total.
        for i in 0..9 {
            fs::write(f.root.join(format!("big{i}.md")), "x").unwrap();
        }
        let big: Vec<_> = snapshot(&f)
            .into_iter()
            .filter(|d| d.path.contains("/big"))
            .map(|d| ProjectChange { path: d.path, before: d.before, after: "y".repeat(DOCUMENT_LIMIT - 1) })
            .collect();
        assert_eq!(big.len(), 9);
        assert!(apply(&f, big).unwrap_err().contains("32 MiB"));
        assert_eq!(read(&f, "big0.md"), b"x");
        assert_originals(&f);
    }

    #[test]
    fn bom_crlf_and_non_ascii_content_is_preserved_byte_for_byte() {
        let f = fixture();
        let before = "\u{feff}---\r\ntitle: Año\r\n---\r\nalpha ñandú 日本語 😀\r\nline\r\n";
        fs::write(f.root.join("Draft/rich.md"), before.as_bytes()).unwrap();
        let after = before.replace("alpha", "beta");
        let changes = vec![ProjectChange {
            path: portable(&f.root.join("Draft/rich.md")).unwrap(),
            before: before.into(),
            after: after.clone(),
        }];
        apply(&f, changes).unwrap();
        assert_eq!(read(&f, "Draft/rich.md"), after.as_bytes());
        assert_eq!(read(&f, "Draft/rich.md")[..3], [0xEF, 0xBB, 0xBF]);
    }

    #[test]
    fn unauthorized_scope_never_changes_files() {
        let f = fixture();
        assert!(snapshot_in(&f.state, &f.root, &|_| false).is_err());
        let changes = plan(&f);
        assert!(commit_in(&f.state, &f.root, changes, None, &|_| false, &mut |_| Ok(())).is_err());
        assert_originals(&f);
    }
}
