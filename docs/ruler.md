# Visual ruler guides

Enable **Ruler**, then open **Guides** on the sheet. Use **+ Row** for a horizontal line or **+ Column** for a vertical line. There is no fixed guide-count limit.

Drag a line's handle at the left or top edge of the sheet, or enter its position in millimetres in the guide list. Arrow keys move a focused handle by 1 mm; Shift + arrow moves it by 10 mm. Delete removes the focused guide. The list also provides individual remove buttons and **Clear**.

These are visual references only: images do not snap, move, or resize when guides change. Lines do not capture clicks over document content; only their edge handles and controls are interactive. Hiding Ruler hides the guides without deleting them. They never enter Markdown, page previews, or exported PDFs.

Guides are shared across editing canvases and saved automatically in `setting.json` under `settings.rulerGuides`. Guide positions are measured from the top or left page edge. Changing paper size retains off-page positions; they remain editable in the list and reappear when the paper size permits. Persistence uses the normal preferences file-size safety limit, not a fixed number of guides.
