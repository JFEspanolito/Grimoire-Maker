# Grimoire Maker Installers & Packages

Grimoire Maker is distributed as native desktop binaries for Windows and macOS. Detailed build, packaging, and testing guides are split by platform:

- [**Windows Installer & Portable Edition Guide**](installer_windows.md)  
  Covers the NSIS per-user wizard installer (`.exe`), silent installation flags (`/S`, `/CONTENTDIR=`), custom content folder derivation, portable mode (`portable.flag`, `Data\`), and the Windows QA testing checklist.

- [**macOS DMG Installation & Build Guide**](installer_mac.md)  
  Covers the Apple Disk Image (`.dmg`) package, application bundle structure (`.app`), WebKit integration, user library paths (`~/Library/Application Support/app.grimoiremaker.desktop`), Gatekeeper troubleshooting, and the macOS QA testing checklist.
