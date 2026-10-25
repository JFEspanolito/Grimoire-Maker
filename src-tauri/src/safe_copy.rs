//! Shared guarded, no-overwrite copying for native configuration and library changes.
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

fn metadata(path: &Path) -> Result<fs::Metadata, String> {
    let info = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    reject_special(&info)?;
    Ok(info)
}
pub(crate) fn reject_special(info: &fs::Metadata) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if info.file_attributes() & 0x400 != 0 {
            return Err("Links and reparse points are not supported".into());
        }
    }
    if info.file_type().is_symlink() || !(info.is_dir() || info.is_file()) {
        return Err("Links and special files are not supported".into());
    }
    Ok(())
}

/// Windows handles deny rename/delete while paths are in use and open reparse points themselves.
pub(crate) fn open_checked(path: &Path, directory: bool) -> Result<File, String> {
    let before = metadata(path)?;
    if before.is_dir() != directory {
        return Err("Expected a regular directory or file".into());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000 | if directory { 0x02000000 } else { 0 });
        options.share_mode(if directory { 3 } else { 1 });
    }
    let file = options.open(path).map_err(|e| e.to_string())?;
    let after = file.metadata().map_err(|e| e.to_string())?;
    reject_special(&after)?;
    if after.is_dir() != directory {
        return Err("Directory changed during access".into());
    }
    Ok(file)
}

pub(crate) fn lock_ancestors(path: &Path, locks: &mut Vec<File>) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("Library paths must be absolute".into());
    }
    for ancestor in path.ancestors().collect::<Vec<_>>().into_iter().rev() {
        locks.push(open_checked(ancestor, true)?);
    }
    Ok(())
}

pub(crate) struct CopyEntry {
    pub(crate) relative: PathBuf,
    pub(crate) source: Option<File>,
}
pub(crate) fn inventory(
    root: &Path,
    relative: &Path,
    entries: &mut Vec<CopyEntry>,
    locks: &mut Vec<File>,
) -> Result<(), String> {
    for child in fs::read_dir(root.join(relative)).map_err(|e| e.to_string())? {
        let child = child.map_err(|e| e.to_string())?;
        let relative = relative.join(child.file_name());
        let path = root.join(&relative);
        if metadata(&path)?.is_dir() {
            locks.push(open_checked(&path, true)?);
            entries.push(CopyEntry {
                relative: relative.clone(),
                source: None,
            });
            inventory(root, &relative, entries, locks)?;
        } else {
            entries.push(CopyEntry {
                relative,
                source: Some(open_checked(&path, false)?),
            });
        }
    }
    Ok(())
}

pub(crate) fn copy_entries(
    entries: Vec<CopyEntry>,
    destination: &Path,
    locks: &mut Vec<File>,
    mut transform: impl FnMut(&Path, &mut File) -> Result<Option<Vec<u8>>, String>,
) -> Result<(), String> {
    for mut entry in entries {
        let target = destination.join(&entry.relative);
        if let Some(ref mut input) = entry.source {
            let replacement = transform(&entry.relative, input)?;
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)
                .map_err(|e| e.to_string())?;
            if let Some(bytes) = replacement {
                output.write_all(&bytes).map_err(|e| e.to_string())?;
            } else {
                std::io::copy(input, &mut output).map_err(|e| e.to_string())?;
            }
            output.sync_all().map_err(|e| e.to_string())?;
        } else {
            fs::create_dir(&target).map_err(|e| e.to_string())?;
            locks.push(open_checked(&target, true)?);
        }
    }
    Ok(())
}
