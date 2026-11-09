# macOS Build & Installation Guide

Grimoire Maker ships for macOS as an Apple Disk Image (`.dmg`) containing the universal application bundle (`Grimoire Maker.app`).

| Artifact | How to build | Output |
| --- | --- | --- |
| macOS Disk Image (local/unsigned) | `pnpm build:dmg` | `src-tauri/target/release/bundle/dmg/Grimoire.Maker_<version>_<arch>.dmg` |
| macOS Disk Image (signed) | `pnpm build:dmg:signed` | `src-tauri/target/release/bundle/dmg/Grimoire.Maker_<version>_<arch>.dmg` |

Both commands execute `tauri build --bundles dmg,app`, which compiles the frontend first (`pnpm build`, including strict typechecking via `tsc -b`) before invoking `cargo build --release`.

---

## 1. Installation Workflow

1. Download the `.dmg` asset matching your Mac architecture from [GitHub Releases](https://github.com/JFEspanolito/Grimoire-Maker/releases):
   - **Apple Silicon (M1/M2/M3/M4):** `Grimoire.Maker_<version>_aarch64.dmg`
   - **Intel x64:** `Grimoire.Maker_<version>_x64.dmg`
2. Double-click the `.dmg` file to mount the disk image.
3. Drag **Grimoire Maker.app** into your `/Applications` folder.
4. Eject the mounted disk image.

---

## 2. Runtime & System Paths

Unlike Windows, macOS requires no external runtime installers like WebView2; Tauri natively uses the system **WebKit** framework included in macOS.

### File System Layout
All application settings, seeded libraries, and diagnostic logs live under the standard macOS user library hierarchy:

| Resource | Path |
| --- | --- |
| **Application Support Root** | `~/Library/Application Support/app.grimoiremaker.desktop/` |
| **Content Folders (Mods)** | `~/Library/Application Support/app.grimoiremaker.desktop/Mods/` (`Plugins/`, `Snippets/`, `Templates/`) |
| **Themes & Logs** | `~/Library/Application Support/app.grimoiremaker.desktop/Themes/` and `.../logs/` |
| **Preferences & State** | `~/Library/Application Support/app.grimoiremaker.desktop/setting.json` and `state.json` |
| **Caches & WebKit Storage** | `~/Library/Caches/app.grimoiremaker.desktop/` and `~/Library/WebKit/app.grimoiremaker.desktop/` |

On first launch, default Templates, Snippets, Themes, and Plugins are automatically seeded into your Application Support directory. Individual content directory paths can be customized at any time in **Settings → Preferences**.

---

## 3. macOS Security & Gatekeeper Troubleshooting

If installing a release that is self-signed or pending Apple Notarization, macOS Gatekeeper may display a warning:
> *"Grimoire Maker" cannot be opened because Apple cannot check it for malicious software.*  
> or *"Grimoire Maker is damaged and can't be opened."*

### Resolution
1. **From Finder:** Right-click (or Control-click) `Grimoire Maker.app` in `/Applications` and select **Open**. Click **Open** again in the confirmation prompt.
2. **From Terminal (Remove quarantine flag):**
   ```bash
   xattr -cr "/Applications/Grimoire Maker.app"
   ```

---

## 4. Updates & Uninstallation

- **In-App Updater:** Grimoire Maker checks for new versions via GitHub Releases using Tauri's native updater. When an update is accepted, it replaces the `.app` bundle inside `/Applications` in place.
- **Uninstallation:** Drag `/Applications/Grimoire Maker.app` to the Trash. Your user projects and customized content folders remain safely preserved in `~/Library/Application Support/app.grimoiremaker.desktop/`.

---

## 5. Manual Test Checklist (macOS)

Run these checks when validating a new macOS build:

1. **Mount & Install:** Mount the DMG, verify the volume icon and Applications symlink, drag the app into `/Applications`.
2. **First Launch Seeding:** Launch the app; verify `~/Library/Application Support/app.grimoiremaker.desktop/` is created and sample Snippets, Templates, and Themes are populated.
3. **Preferences & Content Paths:** Open **Settings → Preferences**, change a content folder using the native macOS file picker, restart the app, and verify the custom path persists.
4. **PDF / Print Export:** Open a project and trigger Print Preview (`Paged.js`). Verify paginated layout and native PDF print generation via WebKit.
5. **Updater Check:** Trigger a version check via **Settings → About** and confirm release manifest resolution.
