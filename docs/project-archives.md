# Project archives and PDF export

## Project ZIPs

Save editor changes before choosing **Pack ZIP**. Packing includes all saved project
files, binary assets, Draft, Research, Trash, and empty folders. It does not include
unsaved buffers. It is a file backup, not a transactional filesystem snapshot: avoid
editing project files with other applications during packing.

The native command reads the active remembered project from app state; the renderer
cannot supply a source path. A native save dialog chooses a **new** `.zip` file outside
the project. Existing archives are never overwritten, even if the dialog confirms a
replacement. Publication uses an adjacent temporary file and an atomic no-replace
hard link, so the destination filesystem must support hard links (for example NTFS,
APFS, or ext4). Unsupported filesystems return an error without replacing files.

**Restore ZIP** selects an archive, then a save-style dialog selects the name and
location of a **new directory**. The directory must not already exist. Restoration
does not merge into another project. The restored project path is returned for the
normal workspace-opening flow; the native command grants filesystem scope for it.
The UI reports the resulting path, including when opening the restored project fails.

Safety boundaries:

- `.git`, symbolic links, `.import-*`, `.archive-*`, `.grimoire-import-*`,
  `.grimoire-archive-*`, and hidden `.tmp`/`.part`/`.tmp-*` staging entries are excluded from
  packing. Other dotfiles are retained. Archives containing these excluded paths
  or links/special files are rejected rather than followed.
- At most 10,000 entries, 256 MiB per file, 1 GiB expanded content, 1 GiB + 16 MiB
  archive size, and 16 MiB central-directory metadata. Bounds are checked before
  allocating central metadata and while copying file payloads; corrupt CRCs fail.
- UTF-8 paths only, maximum 1,024 bytes and 32 components. Absolute paths, traversal,
  backslashes, Windows device names, trailing spaces/dots, alternate-data-stream
  names, case collisions, duplicates, and file/directory conflicts are rejected.
- ZIP64, split archives, encrypted archives, and compression formats other than
  stored/deflate are unsupported. Permissions and timestamps are not restored.
- Errors remove temporary archive files and incomplete restore directories. A
  cleanup failure is reported explicitly. Existing source/destination files are
  never deleted as part of failure cleanup.
- Archive commands serialize their own operations and offload filesystem and ZIP
  work from the UI thread. They do not lock out external filesystem writers.

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
