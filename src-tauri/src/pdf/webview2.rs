use std::cell::Cell;
use std::rc::Rc;
use std::sync::mpsc;

use tauri::webview::PlatformWebview;
use tauri::WebviewWindow;
use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Environment6, ICoreWebView2_7};
use webview2_com::PrintToPdfCompletedHandler;
use windows_core::{Interface, HSTRING, PCWSTR};

use crate::commands::export::ExportOptions;

const MM_PER_INCH: f64 = 25.4;

pub async fn print_to_pdf(window: &WebviewWindow, options: &ExportOptions) -> Result<(), String> {
    // The printed sheet is the trim size plus bleed on every side.
    let width_in = (options.page_width_mm + 2.0 * options.bleed_mm) / MM_PER_INCH;
    let height_in = (options.page_height_mm + 2.0 * options.bleed_mm) / MM_PER_INCH;
    let path = options.output_path.clone();

    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    window
        .with_webview(move |webview| {
            // SAFETY: runs on the webview's main thread with live COM objects.
            let _ = tx.send(unsafe { print(webview, &path, width_in, height_in) });
        })
        .map_err(|e| e.to_string())?;

    tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "The webview closed before the PDF was written".to_string())?
}

unsafe fn print(
    webview: PlatformWebview,
    path: &str,
    width_in: f64,
    height_in: f64,
) -> Result<(), String> {
    let err = |e: windows_core::Error| e.to_string();

    let core = webview.controller().CoreWebView2().map_err(err)?;
    let core7: ICoreWebView2_7 = core.cast().map_err(err)?;
    let env6: ICoreWebView2Environment6 = webview.environment().cast().map_err(err)?;

    // Paged.js owns margins, so the platform printer adds none.
    let settings = env6.CreatePrintSettings().map_err(err)?;
    settings.SetPageWidth(width_in).map_err(err)?;
    settings.SetPageHeight(height_in).map_err(err)?;
    settings.SetMarginTop(0.0).map_err(err)?;
    settings.SetMarginBottom(0.0).map_err(err)?;
    settings.SetMarginLeft(0.0).map_err(err)?;
    settings.SetMarginRight(0.0).map_err(err)?;
    settings.SetShouldPrintBackgrounds(true).map_err(err)?;
    settings.SetShouldPrintHeaderAndFooter(false).map_err(err)?;

    let wide_path = HSTRING::from(path);
    let succeeded = Rc::new(Cell::new(false));
    let flag = Rc::clone(&succeeded);

    PrintToPdfCompletedHandler::wait_for_async_operation(
        Box::new(move |handler| unsafe {
            core7
                .PrintToPdf(PCWSTR(wide_path.as_ptr()), &settings, &handler)
                .map_err(webview2_com::Error::WindowsError)
        }),
        Box::new(move |error_code, is_successful| {
            error_code?;
            flag.set(is_successful);
            Ok(())
        }),
    )
    .map_err(|e| format!("{e:?}"))?;

    if succeeded.get() {
        Ok(())
    } else {
        Err("WebView2 could not write the PDF".into())
    }
}
