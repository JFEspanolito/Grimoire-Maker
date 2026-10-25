use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Deserialize;

/// The dialog route does not promise a destination or a successful saved file.
#[tauri::command]
pub fn pdf_export_route() -> &'static str {
    if cfg!(windows) {
        "file"
    } else {
        "dialog"
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    /// Trim (finished) page size in millimetres, without bleed.
    pub page_width_mm: f64,
    pub page_height_mm: f64,
    pub bleed_mm: f64,
    /// Destination chosen by the user; must end in `.pdf`.
    pub output_path: String,
}

fn open_pdf_in(path: &Path, launch: impl FnOnce(&Path) -> Result<(), String>) -> Result<(), String> {
    if !path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("pdf"))
    {
        return Err("Output path must end in .pdf".into());
    }
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("Exported PDF is not a regular file".into());
    }
    // Use native separators for the OS launcher rather than portable slash paths.
    let launch_path: PathBuf = path.components().collect();
    launch(&launch_path)
}

fn open_exported_pdf(path: &Path) -> Result<(), String> {
    open_pdf_in(path, |target| {
        #[cfg(target_os = "windows")]
        let program = "explorer.exe";
        #[cfg(target_os = "macos")]
        let program = "open";
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        let program = "xdg-open";
        Command::new(program)
            .arg(target)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    })
}

/// Entry point for PDF export. The headless print pipeline lives in `crate::pdf`.
#[tauri::command]
pub async fn export_pdf(
    window: tauri::WebviewWindow,
    options: ExportOptions,
) -> Result<(), String> {
    crate::pdf::render(&window, &options).await?;
    open_exported_pdf(Path::new(&options.output_path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_exported_pdf_with_native_path_and_rejects_non_pdf_targets() {
        let base =
            std::env::temp_dir().join(format!("grimoire-export-open-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        let pdf = base.join("grimoire.pdf");
        let txt = base.join("notes.txt");
        fs::write(&pdf, b"%PDF-1.7").unwrap();
        fs::write(&txt, b"plain").unwrap();

        let portable = pdf.to_string_lossy().replace('\\', "/");
        let mut launched = false;
        open_pdf_in(Path::new(&portable), |target| {
            launched = true;
            #[cfg(target_os = "windows")]
            assert!(!target.as_os_str().to_string_lossy().contains('/'));
            Ok(())
        })
        .unwrap();
        assert!(launched);

        assert!(open_pdf_in(&txt, |_| panic!("must not launch non-pdf")).is_err());
        assert!(open_pdf_in(&base, |_| panic!("must not launch directory")).is_err());
        assert!(
            open_pdf_in(&base.join("missing.pdf"), |_| panic!("must not launch missing")).is_err()
        );
        fs::remove_dir_all(base).unwrap();
    }
}
