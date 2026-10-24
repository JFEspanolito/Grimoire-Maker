# Standard content boxes

New palette snippets (built-in, template, and community) and `PluginApi.insertContent(markdown)` share `insertContentBox`. Each insertion creates one `standardContentBox`, including multi-block snippets and tables. Tool-only plugins such as Ruler do not insert document nodes. Ordinary typing, paste, file loading, and existing unwrapped content are unchanged.

Inserting or dropping while inside an existing box creates a sibling after that box, not a nested group. This keeps new free-placement boxes anchored to the page rather than another free box.

Click inside a group to reveal its local controls. Its children remain editable; drag **Move** to move the entire group. **Push text** reorders the group in the document without changing placement. **Over text** positions it relative to the page, independently of text flow. Width is expressed in millimetres; clear it for automatic width. Movement follows the current page scale and does not snap to guides. Cancelling a pointer gesture discards it; a completed movement is one undoable edit.

The container has no decorative border. Selection outlines and controls are editor-only and are removed from the paginated preview/PDF copy. The contents retain their own existing styles (for example statblock framing).

Boxes serialize as complete HTML blocks in Markdown, using `data-type="standard-content-box"`, `data-placement`, `data-width-mm`, `data-x-mm`, and `data-y-mm`. Nested content uses the editor schema's HTML serializer, retaining tables, text, and image metadata without introducing a project/archive migration. Coordinates are finite bounded millimetres, and unknown placement values fall back to text flow.

Future document-producing plugins should call the existing `PluginApi.insertContent` API rather than implementing a separate container or insertion pipeline. The API signature is unchanged.

Images placed Over text inside a free group use group-relative coordinates, so dragging the image does not add the group offset a second time. Moving the group keeps its nested content together.
