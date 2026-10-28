---
pluginName: Bookmarks
pluginId: builtin.bookmarks
pluginDescription: Mark places in your book and jump back to them from anywhere in the project.
---
# Bookmarks plugin

Mark places in your book and jump back to them from anywhere in the project.

## Use

- Right-click a paragraph or heading on a page and choose **Add to bookmark**.
- Open **Bookmarks** in the top-right plugin area to see every bookmark of the
  project. Click one to open its document and scroll to that spot; use
  **Remove** to delete it.

Bookmarks are saved with the project in `.grimoire-plugin-builtin.bookmarks.json`,
with paths relative to the project folder.

## How it works

A bookmark stores the document, the block's position among the page's text
blocks and its opening text. When you jump, the text confirms the position, so
a bookmark survives edits above it. If the text itself changes or is deleted,
the plugin tells you instead of scrolling somewhere wrong.

`bookmarks.tsx` exports the plugin and registers a toolbar control and a
context action (`api.registerContextAction`), which the editor shows in its
single right-click menu next to its own items. `bookmarkStore.ts` owns the list and its
saving through the host's per-project data API, `anchors.ts` finds and reveals
blocks, and `BookmarksButton.tsx` holds the dialog.

## Trust model

Plugins run as trusted code in the application's WebView and are **not
sandboxed**. Only enable code you have reviewed and trust.
