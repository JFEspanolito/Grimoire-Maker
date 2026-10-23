# Themes and community templates

Both live in the app config folder (Windows: `%APPDATA%\app.grimoiremaker.desktop`),
created on first launch. Hover the **Theme** selector or the **Templates** header to
see the exact path. Changes are picked up when the app window regains focus.

## Themes: `themes/<id>.css`

The file name (without `.css`) is the theme id: letters, numbers, `-` and `_`.
Built-in ids (`parchment`, `modern`, `dark-fantasy`) are reserved.
Rules must target `[data-theme='<id>']`, otherwise the file is rejected.

```css
/* @name: Sea Foam */
[data-theme='sea-foam'] {
  --page-bg: #eef8f6;
  --page-fg: #12302c;
  --page-font: Georgia, serif;
  --heading-font: Georgia, serif;
  --heading-color: #0b5d54;
  --accent: #14a393;
  --statblock-bg: #dcf0ec;
  --readaloud-bg: #cfe8e3;
}
```

`/* @name: ... */` is the label shown in the selector (defaults to the id).
Theme CSS is applied as-is, so avoid `@import` of remote URLs.

## Templates: `templates/`

Either a single `<id>.md`, or a package folder:

```
templates/
  my-adventure/
    index.md      # frontmatter + starting document (required)
    theme.css     # optional; registered as theme "my-adventure"
```

`index.md` frontmatter may set `pageSize` (`a4`, `letter`, `b5`), `columns` (1 or 2)
and `theme`, plus `templateName` for the label shown in the catalog.
If the package has a `theme.css` and no `theme:` key, the package theme is used.

Not supported yet: `.zip` import/export, auxiliary chapter files and custom snippets.
