# a5-zine template package

This is a complete, copyable template, not a plugin and not a descriptor for hidden built-in content. It contains Markdown only.

## Package contents

- index.md: starting document and catalog metadata.
- README.md: this authoring guide; it is exported with the package but not copied into the project.
- chapters/01-Cover and Introduction.md
- chapters/04-Closing Notes.md
- chapters/Places/02-The Night Market.md
- chapters/Tables/03-Strange Discoveries.md

## Apply this template

1. Open a project.
2. Enable the template in Mod Manager and refresh the catalog after editing its files.
3. Choose it in Templates.

The application creates Draft/a5-zine/index.md and copies every Markdown file under chapters/, preserving nested folders. If that destination exists, it creates a numbered sibling instead of replacing your work. Applying again adds a new copy; editing the template does not change projects already created from it.

## Create your own

1. Copy this entire folder into your configured Content folders → Templates directory.
2. Rename the copied folder to a unique ID using letters, numbers, hyphens or underscores, such as my-adventure. Avoid the three example IDs.
3. Edit templateName in index.md to set its catalog label. The rest of index.md is the opening document, not documentation.
4. Add or edit Markdown files inside chapters/. Subfolders there become subfolders in the generated project.
5. Give each chapter its own frontmatter for title, pageSize, columns and theme. Files are copied as written; chapters do not inherit index.md metadata automatically.
6. Refresh Mod Manager, enable your template and apply it to a test project.

Do not put project documents beside index.md: only index.md and the supported chapters/ and assets/ content are copied. Empty folders are not preserved; include a Markdown document in each folder you want to distribute. File names may contain spaces.

No scripts, React components, installation command or application code changes are needed. Share the entire folder, or use Export template to create a ZIP that another user can import. Keep the folder's structure intact.

## Scope

These examples intentionally use only Markdown and folders. The existing package format also supports optional assets/, theme.css and snippets/, but none are required here. Project-wide settings and files outside the generated Draft folder are not replaced.
