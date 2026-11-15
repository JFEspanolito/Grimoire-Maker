use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Deserialize;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

/// The dialog route does not promise a destination or a successful saved file.
#[tauri::command]
pub fn pdf_export_route() -> &'static str {
    if cfg!(windows) {
        "file"
    } else {
        "dialog"
    }
}

#[derive(Debug)]
pub struct ExportOptions {
    /// Trim (finished) page size in millimetres, without bleed.
    pub page_width_mm: f64,
    pub page_height_mm: f64,
    pub bleed_mm: f64,
    /// Destination chosen by the user; must end in `.pdf`.
    pub output_path: String,
}

/// The renderer supplies layout and a filename suggestion, never a destination.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportRequest {
    page_width_mm: f64,
    page_height_mm: f64,
    bleed_mm: f64,
    suggested_name: Option<String>,
}

fn suggested_filename(value: Option<&str>) -> String {
    let name = value.unwrap_or("document.pdf").rsplit(['/', '\\']).next().unwrap_or("");
    let name: String = name.chars().map(|c| {
        if c.is_control() || ":*?\"<>|".contains(c) { '_' } else { c }
    }).collect();
    let name = name.trim().trim_matches('.');
    if name.is_empty() { return "document.pdf".into(); }
    if name.to_ascii_lowercase().ends_with(".pdf") { name.into() } else { format!("{name}.pdf") }
}

fn select_export_options(
    request: ExportRequest,
    pick: impl FnOnce(&str) -> Result<Option<PathBuf>, String>,
) -> Result<Option<ExportOptions>, String> {
    crate::pdf::validate_page_size(request.page_width_mm, request.page_height_mm, request.bleed_mm)?;
    let Some(path) = pick(&suggested_filename(request.suggested_name.as_deref()))? else {
        return Ok(None);
    };
    let options = ExportOptions {
        page_width_mm: request.page_width_mm,
        page_height_mm: request.page_height_mm,
        bleed_mm: request.bleed_mm,
        output_path: path.to_str().ok_or("PDF destination is not valid Unicode")?.into(),
    };
    crate::pdf::validate(&options)?;
    Ok(Some(options))
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
    options: ExportRequest,
) -> Result<(), String> {
    let app = window.app_handle().clone();
    let options = tauri::async_runtime::spawn_blocking(move || {
        select_export_options(options, |name| {
            app.dialog().file().set_title("Export PDF").add_filter("PDF", &["pdf"])
                .set_file_name(name).blocking_save_file()
                .map(|file| file.into_path().map_err(|error| error.to_string())).transpose()
        })
    }).await.map_err(|error| error.to_string())??;
    let Some(options) = options else { return Ok(()); };
    crate::pdf::render(&window, &options).await?;
    open_exported_pdf(Path::new(&options.output_path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_ipc_cannot_choose_the_output_path() {
        let payload = serde_json::json!({
            "pageWidthMm": 210.0, "pageHeightMm": 297.0, "bleedMm": 0.0,
            "outputPath": "C:/arbitrary/book.pdf"
        });
        assert!(serde_json::from_value::<ExportRequest>(payload).is_err());
    }

    #[test]
    fn export_uses_only_the_native_selection_and_preserves_cancel() {
        let request = || ExportRequest {
            page_width_mm: 210.0, page_height_mm: 297.0, bleed_mm: 3.0,
            suggested_name: Some("C:\\untrusted\\suggested.pdf".into()),
        };
        assert!(select_export_options(request(), |name| {
            assert_eq!(name, "suggested.pdf");
            Ok(None)
        }).unwrap().is_none());
        let selected = select_export_options(request(), |_| Ok(Some(PathBuf::from("chosen.pdf"))))
            .unwrap().unwrap();
        assert_eq!(selected.output_path, "chosen.pdf");
        assert_eq!(selected.bleed_mm, 3.0);
        let mut oversized = request();
        oversized.page_width_mm = 1000.0;
        assert!(select_export_options(oversized, |_| panic!("invalid paper must not open a dialog")).is_err());
        assert_eq!(suggested_filename(Some("../bad:name")), "bad_name.pdf");
        assert_eq!(suggested_filename(Some("../..")), "document.pdf");
    }

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
