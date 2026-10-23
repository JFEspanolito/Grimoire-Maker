# File imports

Open a project, then use **Files → Import to Draft** or **Import to Research**.
The file picker accepts multiple files of any type, including Markdown, images,
PDFs, and reference documents. Files are copied; originals are not moved.
Name collisions get a numeric suffix and exclusive creation prevents overwrite.

Each file is limited to 64 MiB. Imported non-Markdown files are stored as assets;
the Markdown editor is not a PDF or binary document viewer. Cancellation does
nothing. If a copy fails, the error is shown and earlier successful copies stay
visible in the explorer. A failed disk write may leave an incomplete destination;
the original is never removed.
