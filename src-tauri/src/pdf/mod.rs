use crate::commands::export::ExportOptions;

/// Headless PDF pipeline (not implemented yet).
///
/// Planned: load the Paged.js-paginated webview content, print through the
/// platform webview (WebView2 `PrintToPdf` / WebKit print operation) using the
/// exact `@page` size plus bleed, and write the file chosen by the user.
pub fn render(options: &ExportOptions) -> Result<(), String> {
    Err(format!(
        "PDF export is not implemented yet ({} / {}mm bleed / \"{}\")",
        options.page_size, options.bleed_mm, options.title
    ))
}
