import { setupBinder, type BinderFs } from './binder'

export const DEMO_MARKDOWN = `---
title: Welcome to Grimoire Maker
columns: 2
---
# Welcome to Grimoire Maker

Thank you for using Grimoire Maker! Whatever you need—feedback, questions, bug
reports, or feature requests—you can reach out anytime via **Help → Report an Issue**:

- [Report a Bug](https://github.com/JFEspanolito/Grimoire-Maker/issues/new?template=bug_report.md)
- [Request a Feature](https://github.com/JFEspanolito/Grimoire-Maker/issues/new?template=feature_request.md)

## Getting Started

We recommend opening **Help → Tutorial** for a quick walkthrough of the interface.

- **Snippets:** Drag reusable blocks (statblocks, read-aloud boxes, character sheets, and tables) from the **Snippets** panel directly onto the page, or double-click to insert at your cursor.
- **Templates:** Use ready-made layouts and themes for adventures, rulebooks, zines, and manuals, or share your own via **File → Export as Template…**.

<div data-type="column-break"></div>

## Quick Examples

This page uses \`columns: 2\` in its frontmatter and a **Column Break** (**Insert → Column Break**) to flow into two columns.

> **Read-aloud box:** Plain Markdown blockquotes work great for boxed narrative text.

### Sample Encounter Table

| d6 | Encounter | Difficulty |
| --- | --- | --- |
| 1–2 | Goblin Scouts | Easy |
| 3–4 | Whispering Statue | Medium |
| 5–6 | Ashbound Wyrmling | Hard |

---

*Made with love*  
[@jfespanolito](https://www.jfespanolito.dev/linktree)
`

interface ProjectFs extends BinderFs {
  readDir(path: string): Promise<{ name: string }[]>
  writeTextFile(path: string, contents: string, options: { createNew: boolean }): Promise<void>
}

/** Only a new, empty project receives a demo; existing or deliberately emptied binders do not. */
export async function initializeProject(fs: ProjectFs, root: string): Promise<string | null> {
  const empty = (await fs.readDir(root)).every((entry) => entry.name.startsWith('.'))
  const created = await setupBinder(fs, root)
  if (!empty || !created.includes('Draft')) return null
  const chapter = `${root}/Draft/Chapter 1`
  if (await fs.exists(chapter)) return null
  await fs.mkdir(chapter)
  const path = `${chapter}/Welcome.md`
  await fs.writeTextFile(path, DEMO_MARKDOWN, { createNew: true })
  return path
}
