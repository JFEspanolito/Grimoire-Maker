# Read-only file previews

Open supported files from the Files panel in a tab or either split view. Markdown remains editable; PDF, Word and image tabs are read-only and never save over their source files.

Opening another file replaces the active clean tab. A tab with unsaved Markdown changes stays open automatically; **Open in New Tab** always keeps the current tab. Selecting an already open file activates it without duplication. Saving all documents also saves dirty Markdown tabs behind a preview, without writing to preview files.

- **Images:** PNG, JPEG, GIF, WebP, SVG, BMP, AVIF and ICO, subject to the operating system webview's decoder support. Switch between fitted and actual size. SVG is displayed as an image, not injected into the app DOM.
- **PDF:** local PDF.js worker with page navigation and zoom. No online document service is used. This is a page-image preview, not an editor; links, forms, scripts and attachments are not activated. Password-protected or damaged files show an error. Unusual fonts or image codecs may not reproduce exactly.
- **Word DOCX:** paragraphs, basic bold/italic/underline styling and tables from the main document. This content preview does not reproduce pagination, headers, footers, embedded images/objects, equations or Word's full layout. External relationships are ignored.
- **Legacy Word DOC:** convert to DOCX using Word or LibreOffice first. Binary DOC is not interpreted as DOCX.

Files larger than 64 MB are refused before reading. DOCX main-document XML is limited to 8 MB inflated, 5,000 archive entries and 100,000 XML elements. Other archive entries are never inflated or extracted to disk. Loading failures appear inside the tab. Switching tabs retains their view state; closing or replacing a tab releases its preview resources.

PDF rendering follows the [PDF.js canvas examples](https://mozilla.github.io/pdf.js/examples/) with a bundled local worker. The compatibility build supplies newer JavaScript primitives for older desktop webviews.
