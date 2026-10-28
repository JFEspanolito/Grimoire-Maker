//! Bounded, link-safe extraction of an external plugin package into a fresh staging directory.
//! Staging is not a sandbox: nothing extracted here is executed.
use crate::plugin_package::{self as package, Manifest};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::Path,
    time::{Duration, Instant},
};
use zip::ZipArchive;

pub struct Extracted {
    pub manifest: Manifest,
    /// SHA-256 over the sorted `path\0file-hash\n` lines of every extracted file.
    pub fingerprint: String,
}

#[derive(PartialEq)]
enum Kind {
    File,
    Dir,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn check_deadline(deadline: Instant) -> Result<(), String> {
    if Instant::now() >= deadline {
        Err("Extraction took too long and was cancelled".into())
    } else {
        Ok(())
    }
}

/// Reads at most `limit` bytes; one byte more means the entry exceeded its budget.
/// Budgets count bytes actually decompressed, never the sizes the archive declares.
fn copy_bounded(
    reader: &mut impl Read,
    mut sink: impl FnMut(&[u8]) -> Result<(), String>,
    limit: u64,
    deadline: Instant,
) -> Result<u64, String> {
    let mut buffer = [0u8; 64 * 1024];
    let mut total = 0u64;
    loop {
        check_deadline(deadline)?;
        let count = reader.read(&mut buffer).map_err(|error| format!("Corrupt package: {error}"))?;
        if count == 0 {
            return Ok(total);
        }
        total += count as u64;
        if total > limit {
            return Err("A package file exceeds its size budget".into());
        }
        sink(&buffer[..count])?;
    }
}

/// Rejects the whole package on the first hostile or ambiguous entry.
fn plan(archive: &mut ZipArchive<File>) -> Result<Vec<(usize, String, bool)>, String> {
    if archive.len() > package::MAX_ENTRIES {
        return Err(format!("Package has more than {} entries", package::MAX_ENTRIES));
    }
    let mut kinds: HashMap<String, Kind> = HashMap::new();
    let mut explicit: HashSet<String> = HashSet::new();
    let mut entries = Vec::new();
    for index in 0..archive.len() {
        let entry = archive.by_index_raw(index).map_err(|error| format!("Corrupt package: {error}"))?;
        if entry.encrypted() {
            return Err("Encrypted package entries are not supported".into());
        }
        if let Some(mode) = entry.unix_mode() {
            let kind = mode & 0o170000;
            if kind != 0 && kind != 0o100000 && kind != 0o040000 {
                return Err(format!("Package entry '{}' is a link or special file", entry.name()));
            }
        }
        let is_dir = entry.is_dir();
        if !is_dir && entry.size() > package::MAX_FILE_BYTES {
            return Err(format!("Package entry '{}' exceeds the file size budget", entry.name()));
        }
        let path = package::validate_entry_path(entry.name())?;
        package::validate_layout(&path, is_dir)?;
        let key = path.to_lowercase();
        if explicit.contains(&key) {
            return Err(format!("Package has duplicate entries for '{path}' (names are compared ignoring case)"));
        }
        match kinds.get(&key) {
            Some(Kind::File) => return Err(format!("Package entry '{path}' conflicts with a file of the same name")),
            Some(Kind::Dir) if !is_dir => return Err(format!("Package entry '{path}' conflicts with a directory of the same name")),
            _ => {}
        }
        let mut ancestor = String::new();
        let parts: Vec<&str> = key.split('/').collect();
        for part in &parts[..parts.len() - 1] {
            if !ancestor.is_empty() {
                ancestor.push('/');
            }
            ancestor.push_str(part);
            if kinds.get(&ancestor) == Some(&Kind::File) {
                return Err(format!("Package entry '{path}' sits below a file"));
            }
            kinds.insert(ancestor.clone(), Kind::Dir);
        }
        kinds.insert(key.clone(), if is_dir { Kind::Dir } else { Kind::File });
        explicit.insert(key);
        entries.push((index, path, is_dir));
    }
    let count = |name: &str| entries.iter().filter(|(_, path, dir)| !dir && path == name).count();
    if count(package::MANIFEST_ENTRY) != 1 {
        return Err("Package must contain exactly one manifest.json at its root".into());
    }
    if count(package::MAIN_ENTRY) != 1 {
        return Err("Package must contain exactly one dist/index.js".into());
    }
    Ok(entries)
}

/// `staging` must not exist yet and its parent must be a directory we trust. On any error the
/// staging directory created here is removed; nothing outside it is ever touched.
pub fn extract_package(zip_path: &Path, staging: &Path, limit: Duration) -> Result<Extracted, String> {
    let info = fs::symlink_metadata(zip_path).map_err(|error| error.to_string())?;
    crate::safe_copy::reject_special(&info)?;
    if !info.is_file() {
        return Err("The selected plugin package is not a regular file".into());
    }
    if info.len() > package::MAX_ARCHIVE_BYTES {
        return Err("The plugin package is larger than 20 MiB".into());
    }
    let deadline = Instant::now() + limit;
    let mut archive = ZipArchive::new(File::open(zip_path).map_err(|error| error.to_string())?)
        .map_err(|error| format!("The selected file is not a valid plugin package: {error}"))?;
    let entries = plan(&mut archive)?;

    // Fails when the directory already exists, so a pre-planted path or link is never reused.
    fs::create_dir(staging).map_err(|error| format!("Could not create staging directory: {error}"))?;
    let result = write_entries(&mut archive, &entries, staging, deadline);
    if result.is_err() {
        // Only this call created `staging`, so removing it cannot touch anything else.
        let _ = fs::remove_dir_all(staging);
    }
    result
}

fn write_entries(
    archive: &mut ZipArchive<File>,
    entries: &[(usize, String, bool)],
    staging: &Path,
    deadline: Instant,
) -> Result<Extracted, String> {
    let mut manifest: Option<Manifest> = None;
    let mut hashes: Vec<(String, String)> = Vec::new();
    let mut total = 0u64;
    for (index, path, is_dir) in entries {
        check_deadline(deadline)?;
        let target = staging.join(path);
        if *is_dir {
            create_dirs(staging, path)?;
            continue;
        }
        if let Some((parent, _)) = path.rsplit_once('/') {
            create_dirs(staging, parent)?;
        }
        let mut entry = archive.by_index(*index).map_err(|error| format!("Corrupt package: {error}"))?;
        let budget = if path == package::MANIFEST_ENTRY { package::MAX_MANIFEST_BYTES } else { package::MAX_FILE_BYTES };
        let mut file = OpenOptions::new().write(true).create_new(true).open(&target).map_err(|error| error.to_string())?;
        let mut hasher = Sha256::new();
        let mut content = Vec::new();
        let keep = path == package::MANIFEST_ENTRY;
        let size = copy_bounded(
            &mut entry,
            |chunk| {
                hasher.update(chunk);
                if keep {
                    content.extend_from_slice(chunk);
                }
                file.write_all(chunk).map_err(|error| error.to_string())
            },
            budget,
            deadline,
        )?;
        file.sync_all().map_err(|error| error.to_string())?;
        total += size;
        if total > package::MAX_TOTAL_BYTES {
            return Err("The package exceeds the total size budget".into());
        }
        if keep {
            manifest = Some(package::parse_manifest(&content)?);
        }
        hashes.push((path.clone(), hex(&hasher.finalize())));
    }
    Ok(Extracted {
        manifest: manifest.ok_or("manifest.json was not extracted")?,
        fingerprint: combine(hashes),
    })
}

/// Canonical fingerprint: sorted `path\0file-hash\n` lines, so archive order never matters.
fn combine(mut hashes: Vec<(String, String)>) -> String {
    hashes.sort();
    let mut overall = Sha256::new();
    for (path, hash) in &hashes {
        overall.update(path.as_bytes());
        overall.update([0]);
        overall.update(hash.as_bytes());
        overall.update(b"\n");
    }
    hex(&overall.finalize())
}

/// Recomputes the fingerprint of an installed version directory. Any extra, missing, changed or
/// linked file yields a different value (or an error), which callers treat as tampering.
pub fn fingerprint_dir(root: &Path) -> Result<String, String> {
    fn walk(base: &Path, relative: &str, depth: usize, out: &mut Vec<(String, String)>) -> Result<(), String> {
        if depth > package::MAX_DEPTH || out.len() > package::MAX_ENTRIES {
            return Err("Installed plugin is larger than the package limits".into());
        }
        let folder = if relative.is_empty() { base.to_path_buf() } else { base.join(relative) };
        for entry in fs::read_dir(&folder).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = if relative.is_empty() { name } else { format!("{relative}/{name}") };
            let info = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
            crate::safe_copy::reject_special(&info)?;
            if info.is_dir() {
                walk(base, &path, depth + 1, out)?;
            } else {
                let mut hasher = Sha256::new();
                let mut file = File::open(entry.path()).map_err(|error| error.to_string())?;
                let mut buffer = [0u8; 64 * 1024];
                loop {
                    let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
                    if count == 0 {
                        break;
                    }
                    hasher.update(&buffer[..count]);
                }
                out.push((path, hex(&hasher.finalize())));
            }
        }
        Ok(())
    }
    let mut hashes = Vec::new();
    walk(root, "", 0, &mut hashes)?;
    Ok(combine(hashes))
}

/// Creates one component at a time inside our own staging tree and refuses anything that is
/// not a plain directory, so a path can never be redirected through a link.
fn create_dirs(staging: &Path, relative: &str) -> Result<(), String> {
    let mut current = staging.to_path_buf();
    for part in relative.split('/') {
        current.push(part);
        match fs::symlink_metadata(&current) {
            Ok(info) => {
                crate::safe_copy::reject_special(&info)?;
                if !info.is_dir() {
                    return Err(format!("Package path '{relative}' conflicts with a file"));
                }
            }
            Err(_) => fs::create_dir(&current).map_err(|error| error.to_string())?,
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

    const MANIFEST: &str = r#"{"schemaVersion":1,"sdkVersion":1,"id":"community.zoom","name":"Zoom","version":"1.0.0","author":"A","description":"D","main":"dist/index.js","permissions":["editor:zoom:read"]}"#;

    struct Scratch(std::path::PathBuf);
    impl Scratch {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "grimoire-plugin-install-{tag}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
            ));
            fs::create_dir_all(&path).unwrap();
            Scratch(path)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn options() -> SimpleFileOptions {
        SimpleFileOptions::default().compression_method(CompressionMethod::Deflated)
    }

    fn build(scratch: &Scratch, name: &str, fill: impl FnOnce(&mut ZipWriter<Cursor<Vec<u8>>>)) -> std::path::PathBuf {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        fill(&mut writer);
        let path = scratch.0.join(name);
        fs::write(&path, writer.finish().unwrap().into_inner()).unwrap();
        path
    }

    fn valid(writer: &mut ZipWriter<Cursor<Vec<u8>>>) {
        writer.start_file("manifest.json", options()).unwrap();
        writer.write_all(MANIFEST.as_bytes()).unwrap();
        writer.start_file("dist/index.js", options()).unwrap();
        writer.write_all(b"export default {}").unwrap();
    }

    fn extract(scratch: &Scratch, zip: &Path) -> Result<Extracted, String> {
        extract_package(zip, &scratch.0.join("staging"), Duration::from_secs(30))
    }

    fn assert_rejected_cleanly(scratch: &Scratch, zip: &Path, needle: &str) {
        let error = extract(scratch, zip).err().expect("package should be rejected");
        assert!(error.contains(needle), "expected '{needle}' in '{error}'");
        assert!(!scratch.0.join("staging").exists(), "staging must not survive a rejection");
    }

    #[test]
    fn extracts_a_valid_package_with_a_stable_fingerprint() {
        let scratch = Scratch::new("valid");
        let first = build(&scratch, "a.zip", valid);
        let extracted = extract(&scratch, &first).unwrap();
        assert_eq!(extracted.manifest.id, "community.zoom");
        assert_eq!(fs::read(scratch.0.join("staging/dist/index.js")).unwrap(), b"export default {}");
        assert_eq!(extracted.fingerprint.len(), 64);
        let staging = scratch.0.join("staging");
        assert_eq!(fingerprint_dir(&staging).unwrap(), extracted.fingerprint);
        fs::write(staging.join("dist/extra.js"), "x").unwrap();
        assert_ne!(fingerprint_dir(&staging).unwrap(), extracted.fingerprint);
        fs::remove_file(staging.join("dist/extra.js")).unwrap();
        fs::write(staging.join("dist/index.js"), "tampered").unwrap();
        assert_ne!(fingerprint_dir(&staging).unwrap(), extracted.fingerprint);
        fs::write(staging.join("dist/index.js"), "export default {}").unwrap();
        // The same content in another archive order hashes the same; different bytes do not.
        fs::remove_dir_all(scratch.0.join("staging")).unwrap();
        let reordered = build(&scratch, "b.zip", |w| {
            w.start_file("dist/index.js", options()).unwrap();
            w.write_all(b"export default {}").unwrap();
            w.start_file("manifest.json", options()).unwrap();
            w.write_all(MANIFEST.as_bytes()).unwrap();
        });
        assert_eq!(extract(&scratch, &reordered).unwrap().fingerprint, extracted.fingerprint);
        fs::remove_dir_all(scratch.0.join("staging")).unwrap();
        let changed = build(&scratch, "c.zip", |w| {
            w.start_file("manifest.json", options()).unwrap();
            w.write_all(MANIFEST.as_bytes()).unwrap();
            w.start_file("dist/index.js", options()).unwrap();
            w.write_all(b"export default {1}").unwrap();
        });
        assert_ne!(extract(&scratch, &changed).unwrap().fingerprint, extracted.fingerprint);
    }

    #[test]
    fn rejects_hostile_entry_names_without_skipping() {
        for (index, name) in ["../evil.js", "dist/../../evil.js", "/abs.js", "C:/evil.js", "dist\\evil.js", "dist/a:ads", "dist/NUL", "dist/x."].iter().enumerate() {
            let scratch = Scratch::new(&format!("name{index}"));
            let zip = build(&scratch, "bad.zip", |w| {
                valid(w);
                w.start_file(*name, options()).unwrap();
                w.write_all(b"x").unwrap();
            });
            assert_rejected_cleanly(&scratch, &zip, "Archive entry");
        }
    }

    #[test]
    fn rejects_files_outside_the_package_layout() {
        let scratch = Scratch::new("layout");
        let zip = build(&scratch, "bad.zip", |w| {
            valid(w);
            w.start_file("README.md", options()).unwrap();
            w.write_all(b"x").unwrap();
        });
        assert_rejected_cleanly(&scratch, &zip, "outside manifest.json and dist/");
    }

    #[test]
    fn rejects_case_duplicates_and_file_directory_conflicts() {
        let scratch = Scratch::new("dup");
        let zip = build(&scratch, "bad.zip", |w| {
            valid(w);
            w.start_file("dist/Index.JS", options()).unwrap();
            w.write_all(b"x").unwrap();
        });
        assert_rejected_cleanly(&scratch, &zip, "duplicate");
        let scratch = Scratch::new("conflict");
        let zip = build(&scratch, "bad.zip", |w| {
            valid(w);
            w.start_file("dist/lib", options()).unwrap();
            w.write_all(b"x").unwrap();
            w.start_file("dist/lib/a.js", options()).unwrap();
            w.write_all(b"x").unwrap();
        });
        assert_rejected_cleanly(&scratch, &zip, "below a file");
    }

    #[test]
    fn rejects_links_and_missing_required_files() {
        let scratch = Scratch::new("link");
        let zip = build(&scratch, "bad.zip", |w| {
            valid(w);
            w.add_symlink("dist/link.js", "index.js", options()).unwrap();
        });
        assert_rejected_cleanly(&scratch, &zip, "link or special file");
        let scratch = Scratch::new("missing");
        let zip = build(&scratch, "bad.zip", |w| {
            w.start_file("manifest.json", options()).unwrap();
            w.write_all(MANIFEST.as_bytes()).unwrap();
        });
        assert_rejected_cleanly(&scratch, &zip, "dist/index.js");
    }

    #[test]
    fn enforces_budgets_while_decompressing() {
        let zeros = vec![0u8; 9 * 1024 * 1024];
        let scratch = Scratch::new("big");
        let zip = build(&scratch, "bad.zip", |w| {
            valid(w);
            w.start_file("dist/big.bin", options()).unwrap();
            w.write_all(&zeros).unwrap();
        });
        assert_rejected_cleanly(&scratch, &zip, "size budget");

        let scratch = Scratch::new("total");
        let chunk = vec![0u8; 7 * 1024 * 1024];
        let zip = build(&scratch, "bad.zip", |w| {
            valid(w);
            for index in 0..5 {
                w.start_file(format!("dist/{index}.bin"), options()).unwrap();
                w.write_all(&chunk).unwrap();
            }
        });
        assert_rejected_cleanly(&scratch, &zip, "total size budget");

        let scratch = Scratch::new("many");
        let zip = build(&scratch, "bad.zip", |w| {
            valid(w);
            for index in 0..260 {
                w.start_file(format!("dist/f{index}.js"), options()).unwrap();
            }
        });
        assert_rejected_cleanly(&scratch, &zip, "more than 256 entries");
    }

    #[test]
    fn rejects_corrupt_or_invalid_packages_and_cleans_up() {
        let scratch = Scratch::new("corrupt");
        let path = scratch.0.join("bad.zip");
        fs::write(&path, b"this is not a zip").unwrap();
        assert_rejected_cleanly(&scratch, &path, "not a valid plugin package");

        let zip = build(&scratch, "badmanifest.zip", |w| {
            w.start_file("manifest.json", options()).unwrap();
            w.write_all(br#"{"id":"builtin.zoom"}"#).unwrap();
            w.start_file("dist/index.js", options()).unwrap();
        });
        assert!(extract(&scratch, &zip).is_err());
        assert!(!scratch.0.join("staging").exists());
        assert!(extract(&scratch, &scratch.0.join("missing.zip")).is_err());
    }

    #[test]
    fn expired_deadline_cancels_and_existing_staging_is_never_reused() {
        let scratch = Scratch::new("deadline");
        let zip = build(&scratch, "a.zip", valid);
        assert!(extract_package(&zip, &scratch.0.join("staging"), Duration::ZERO).is_err());
        assert!(!scratch.0.join("staging").exists());
        fs::create_dir(scratch.0.join("staging")).unwrap();
        fs::write(scratch.0.join("staging/keep.txt"), "mine").unwrap();
        assert!(extract(&scratch, &zip).is_err());
        assert_eq!(fs::read(scratch.0.join("staging/keep.txt")).unwrap(), b"mine");
    }
}
