import { setupBinder, type BinderFs } from './binder'

export const DEMO_MARKDOWN = `# Welcome to Grimoire Maker

Start writing your adventure here. Drag blocks from the **Snippets** palette,
or edit the Markdown directly: the page view is the source of truth.

> Read-aloud boxes and statblocks are stored as plain Markdown blocks.
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
