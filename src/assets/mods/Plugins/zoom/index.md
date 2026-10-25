---
pluginName: Zoom
pluginId: builtin.zoom
---
# Zoom plugin

This folder is a complete executable plugin. `zoom.tsx` exports the plugin and
the editor/preview dropdown components. `script.ts` owns zoom levels and the
Ctrl+wheel behavior. `Zoom.module.css` contains its styles. This Markdown file
is documentation; it does not implement the plugin.

## Install and share

1. Copy the entire `zoom` folder into the application's configured **Plugins**
   content folder. Keep all source/style files together.
2. Open the mod manager, refresh the catalog, and enable **Zoom**. If it was
   already enabled, refresh reloads changed source files.
3. Use the toolbar selector or hold Ctrl while scrolling over an editor page.
   The print preview has its own selector and zoom stops.

Copying this folder to another installation of Grimoire Maker with the v1 plugin
API transfers the implementation. No build step or separate npm installation is
needed. Do not install a second copy with the same plugin ID: `builtin.zoom`.

## How it works

The default export provides `id`, `name`, `version`, and `activate(api)`.
Activation registers a main toolbar component, a preview toolbar component, and
a page behavior. The host renders these generic slots; no Zoom-specific host
component is required. The native wheel listener returns its cleanup callback,
so disabling the plugin or unmounting a page removes it. Disabling leaves the
saved zoom preference intact but removes the controls and wheel behavior.

The plugin uses the host React runtime for JSX and `@grimoire/plugin-api` for
persisted page settings, active-document state and types. Relative imports keep
helper code in this folder.

## Trust model

Phase one plugins run as trusted code in the application's WebView, with the
same authority as the application. They are **not sandboxed**. Only enable code
you have reviewed and trust. Isolation for externally supplied plugins is a
separate future phase.
