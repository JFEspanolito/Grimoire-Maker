use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    pub page_size: String,
    pub bleed_mm: f32,
    pub title: String,
}

/// Entry point for PDF export. The headless print pipeline lives in `crate::pdf`.
#[tauri::command]
pub fn export_pdf(options: ExportOptions) -> Result<(), String> {
    crate::pdf::render(&options)
}
