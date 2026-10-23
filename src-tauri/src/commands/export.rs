use serde::Deserialize;

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

/// Entry point for PDF export. The headless print pipeline lives in `crate::pdf`.
#[tauri::command]
pub async fn export_pdf(
    window: tauri::WebviewWindow,
    options: ExportOptions,
) -> Result<(), String> {
    crate::pdf::render(&window, &options).await
}
