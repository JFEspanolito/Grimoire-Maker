# Workspace interface

The application menu groups **File** actions (open, save, import, PDF), **Project**
actions (open project, pack/restore ZIP), and **View** controls. Menus work with
keyboard focus and Enter; Escape dismisses a menu and returns focus to its label.

The quick toolbar separates document actions, side panels, page setup,
appearance/preview, and editor tools. **Ruler** and **Split View** remain at the
right. Hide Files, Templates, or Snippets to reclaim horizontal workspace.

**Sci-Fi** is included in the Theme selector. It uses the same scoped CSS-variable
contract as custom themes, with a light technical-manual palette suitable for
printing. Parchment and existing themes remain available.

Shell, menu, toolbar, and split layout styles use CSS Modules. Tailwind remains for
existing components; global page/print CSS remains global because it is shared
with the Paged.js export document. `src/assets/grimoire-mark.svg` is the local
application-menu mark, bundled without a network request.
