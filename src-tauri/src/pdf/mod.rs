//! Headless PDF pipeline.
//!
//! The webview paginates the document with Paged.js into a print-only layout; the
//! platform webview then prints it to PDF at the exact trim size plus bleed.
//! Windows writes directly through WebView2. Other platforms use the system print
//! dialog from JavaScript so its afterprint event owns paginated DOM cleanup.
use std::path::Path;

use tauri::WebviewWindow;

use crate::commands::export::ExportOptions;

#[cfg(windows)]
mod webview2;

fn validate(options: &ExportOptions) -> Result<(), String> {
    let sizes_ok = [options.page_width_mm, options.page_height_mm]
        .iter()
        .all(|v| v.is_finite() && *v > 0.0);
    if !sizes_ok || !options.bleed_mm.is_finite() || options.bleed_mm < 0.0 {
        return Err("Invalid page size or bleed".into());
    }
    let path = Path::new(&options.output_path);
    if !path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("pdf"))
    {
        return Err("Output path must end in .pdf".into());
    }
    match path.parent() {
        Some(dir) if dir.as_os_str().is_empty() || dir.is_dir() => Ok(()),
        _ => Err("Output folder does not exist".into()),
    }
}

pub async fn render(window: &WebviewWindow, options: &ExportOptions) -> Result<(), String> {
    validate(options)?;
    #[cfg(windows)]
    {
        webview2::print_to_pdf(window, options).await
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        Err("Use the system print dialog to save a PDF on this platform".into())
    }
}
