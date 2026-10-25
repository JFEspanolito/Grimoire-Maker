# Project archives and PDF export

## Project ZIPs

Pack ZIP and Restore ZIP are no longer exposed in the File menu. Use Save/Auto save for document persistence and Source control for Git history. The native archive commands remain for compatibility; this UI change does not remove template package import/export.

## PDF routes

- **Windows:** the existing WebView2 pipeline writes directly to the selected PDF.
  The paginated DOM remains mounted until the native completion result.
- **macOS / Linux / browser development:** export paginates first, explains that the
  system print dialog will open, then calls `window.print()`. Choose **Save to PDF**
  or **Print to File** in the system dialog. Available destinations and printer
  defaults depend on the operating system. The app does **not** report a file as
  saved, because the dialog provides no reliable saved-file result.

The dialog route keeps the print DOM until `afterprint`. If a webview does not emit
that event, close the native dialog and choose **Finished with print dialog** in the
app to release the print layout. Do not dismiss it while the print dialog is active.
Use the matching paper size, no additional printer margins, background graphics,
and no browser headers/footers for the closest match to the paginated preview.
The active editor is exported when split view is enabled.

No cloud service, browser download, or external executable is involved.

### API evidence and proof limits

- [Tauri WebviewWindow print documentation](https://docs.rs/tauri/2.12.5/tauri/webview/struct.WebviewWindow.html#method.print)
  documents `window.print()` as cross-platform; native `print()` does not expose
  a completion callback. The installed Tauri 2.12.5 and Wry 0.57.0 source was checked.
- [ZIP writer API](https://docs.rs/zip/8.6.0/zip/write/struct.ZipWriter.html) supplies
  deflate writing; all extraction paths are validated by this app before creation.

Automated tests cover ZIP round trips, no-overwrite, malicious paths, collisions,
symlinks, declared-size limits, corrupt payload cleanup, and frontend print-DOM
lifetime. They do not prove native dialogs, printer output, or paper layout on
macOS/Linux. Those platforms require an actual desktop smoke test; Windows-native
PDF output also requires a runtime visual check.
