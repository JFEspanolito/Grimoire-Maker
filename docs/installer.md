# Installer and portable build

Grimoire Maker ships for Windows in two forms. Both are built from the same release executable.

| Artifact | How to build | Output |
| --- | --- | --- |
| NSIS installer (per-user, no admin) | `pnpm build:installer` | `src-tauri/target/release/bundle/nsis/Grimoire Maker_<version>_x64-setup.exe` |
| Portable zip | `pnpm build:portable` | `release/GrimoireMaker-portable-<version>-x64.zip` |

Both scripts run `tauri build`, which builds the frontend first (`pnpm build`, including `tsc -b`). There is no `.msi`: the bundle target is NSIS only.

## Installer

* Per-user install (`installMode: currentUser`): no administrator rights, default folder
  `%LOCALAPPDATA%\Grimoire Maker`. English and Spanish; the language follows Windows.
* Wizard pages, in order: **Welcome**, (reinstall/maintenance page on upgrades), **install folder**,
  **Content folders** (optional), Start Menu folder, installing, finish.
  `src-tauri/nsis/installer.nsi` vendors the [Tauri CLI 2.12.4 template](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.4/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi).
  Its only upstream delta inserts our custom page after `MUI_PAGE_DIRECTORY`. Keep that insertion when
  updating the template with Tauri; declaring a page in the early hooks include puts it before Welcome.
* **Content folders** is shown on interactive first installs and reinstalls. **Customize content folders**
  is unchecked by default: continue without selecting it to preserve existing paths (or app defaults on
  a fresh install), without writing a new content request. Select it to choose one root;
  the installer derives `Mods/Plugins`, `Mods/Snippets`, `Mods/Templates`, `Mods/Themes`, and `logs` beneath it.
  The default is `%APPDATA%\GriomoireMaker`; a previous installer selection is pre-filled when available.
  This is separate from the executable installation directory.
  The preceding native **Choose Install Location** page requires confirming the program destination
  before installation; a previous destination is prefilled, not a reason to skip this page.
* Absolute drive and ordinary network-share paths are accepted, including the configuration root itself.
  Paths are limited to 240 characters. Relative paths, device names, administrative shares, control characters,
  invalid Windows characters and ambiguous path segments remain rejected. Rules are shared through
  `src-tauri/nsis/hint-path-cases.json` and checked by Rust and `scripts/nsis-hints.test.ts`.
* After an explicit interactive selection and copying the app, setup creates those five folders and writes a UTF-16LE/BOM root selection to
  `%APPDATA%\GriomoireMaker\install-content-root-v2.txt`. On next launch the app atomically updates only the
  five saved paths, retaining other settings. Existing content is **not moved or deleted**. If selecting another
  root, old content stays at its original location. Individual folders can still be changed in Preferences.
* The root and request write timestamp are saved with preferences, so the same retained request cannot undo
  later individual folder choices. A new installer selection is a new request, even when selecting the same root.
  The request also serves as prefill for later reinstalls. Older `install-content-root.txt` hints retain their
  first-run-only behavior and never override saved paths.
* **Passive** (`/P`), **update** (`/UPDATE`) and **silent** installs have no page. Existing settings are preserved
  unless `/CONTENTDIR=` explicitly selects a new root. New unattended installs default to `%APPDATA%\GriomoireMaker`.
* If a v2 selection cannot be validated or its folders cannot be created on launch, applying it reports an error;
  existing saved paths remain intact and the request remains available to retry. No partial path set is published.

### Silent install

```
"Grimoire Maker_0.1.0_x64-setup.exe" /S /CONTENTDIR="D:\My Books\Grimoire Maker"
```

Without `/CONTENTDIR=` a fresh silent install uses `%APPDATA%\GriomoireMaker`; an upgrade preserves saved paths. If the path is invalid or the folders cannot
be created, the app files are still installed, no hint is written (the app starts with its normal defaults) and the
installer exits with code 2.

### Uninstall

The uninstaller removes the program files, shortcuts and registry entries only. It never touches the content
folders, `setting.json`, `install-content-root.txt(.applied)`, `install-content-root-v2.txt` or any other user data. The template's optional
"Delete app data" checkbox only deletes `%APPDATA%\app.grimoiremaker.desktop` and
`%LOCALAPPDATA%\app.grimoiremaker.desktop` (the Tauri/WebView2 caches), never `%APPDATA%\GriomoireMaker` and never the chosen content root.

### WebView2

`webviewInstallMode` is `downloadBootstrapper` (the Tauri default): the installer downloads and runs Microsoft's
small bootstrapper only when the WebView2 runtime is missing. This needs internet on such machines.
Windows 11 and up-to-date Windows 10 already include it.

## Portable

The zip contains `Grimoire Maker.exe`, an empty `portable.flag` and `README-portable.txt`.

* With `portable.flag` next to the exe the app runs in portable mode: the config root is `<exe folder>\Data`
  (`setting.json`, `state`, `ManagedPlugins`, `mods.json`), the default content folders are
  `Data\Plugins`, `Snippets`, `Templates`, `Themes`, `Logs`, and the WebView2 profile is `Data\WebView2`.
  Nothing is written to `%APPDATA%` or `%LOCALAPPDATA%`.
* Moving or copying the whole folder keeps it working (saved portable paths are re-based).
* If the folder is not writable (or `Data` cannot be created or is not a folder) the app shows a native message box with a
  plain explanation and exits with code 1; it does not fall back to `%APPDATA%`. This covers any failure to prepare the
  portable configuration, and installed (non-portable) runs are unchanged.
* No auto-update. The WebView2 **Evergreen runtime** must be installed (preinstalled on Windows 11); get it at
  https://developer.microsoft.com/microsoft-edge/webview2/ .
* The zip is deterministic (sorted entries, fixed timestamps). `scripts/make-portable.mjs [--exe <path>] [--out <folder>]` only
  packages an existing exe and fails with a plain message if it is missing.

## Manual test checklist

Run these checks on a spare Windows user or VM. Never delete the real user's configuration to simulate a fresh install.
Automated tests and a successful build do not prove the installed wizard behavior.

1. **Fresh interactive install:** expect Content folders, default `%APPDATA%\GriomoireMaker`. Select that root.
   Verify `Mods/Plugins`, `Mods/Snippets`, `Mods/Templates`, `Mods/Themes`, `logs` and the corresponding Preferences paths.
2. **Custom path:** choose a folder with spaces and accents. Verify all five paths and example seeding on launch.
3. **Reinstall:** expect Content folders even when settings already exist, pre-filled with the previous selection.
   Choose another root; verify other settings and old content remain unchanged while the five paths update.
4. **Individual preferences:** customize one path after launch, restart without reinstalling, and verify it stays custom.
5. **Unattended upgrade:** without `/CONTENTDIR`, saved paths must remain unchanged. With it, only the five paths change.
6. **Invalid input:** relative paths, device names, invalid characters and paths over 240 characters are refused.
7. **Uninstall:** content and settings remain untouched.
8. **Portable:** `Data/Plugins`, `Snippets`, `Templates`, `Themes`, `Logs` remain flat; installer requests are ignored.
9. **Unavailable content drive:** the v2 request reports an error without replacing saved paths; retry with the drive available.
