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

pub(crate) fn validate_page_size(width: f64, height: f64, bleed: f64) -> Result<(), String> {
    let sizes_ok = [width, height]
        .iter()
        .all(|v| v.is_finite() && *v > 0.0);
    if !sizes_ok || !bleed.is_finite() || bleed < 0.0 {
        return Err("Invalid page size or bleed".into());
    }
    if width + 2.0 * bleed > 1000.0 || height + 2.0 * bleed > 1000.0 {
        return Err("PDF paper dimensions including bleed must not exceed 1000 mm".into());
    }
    Ok(())
}

pub(crate) fn validate(options: &ExportOptions) -> Result<(), String> {
    validate_page_size(options.page_width_mm, options.page_height_mm, options.bleed_mm)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paper_size_including_bleed_is_bounded_before_rendering() {
        let mut options = ExportOptions {
            page_width_mm: 1000.0, page_height_mm: 1000.0, bleed_mm: 0.0,
            output_path: "book.pdf".into(),
        };
        assert!(validate(&options).is_ok());
        options.bleed_mm = 0.1;
        assert!(validate(&options).is_err(), "bleed must count towards the paper limit");
        options.bleed_mm = 0.0;
        options.page_width_mm = 1000.1;
        assert!(validate(&options).is_err());
        options.page_width_mm = 210.0;
        options.page_height_mm = 1000.1;
        assert!(validate(&options).is_err());
        options.page_height_mm = 297.0;
        for invalid in [f64::NAN, f64::INFINITY, -1.0] {
            options.bleed_mm = invalid;
            assert!(validate(&options).is_err());
        }
    }
}
