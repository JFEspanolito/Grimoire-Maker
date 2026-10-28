import { parseDocument } from './frontmatter'

export interface TemplateSnippet {
  id: string
  label: string
  group: string
  /** Nested subfolder path inside the snippet category (e.g. `Character Sheets` or `Tables & Utilities`). */
  subgroup?: string
  markdown: string
}

interface SnippetFs {
  readDir(path: string): Promise<{ name: string; isDirectory: boolean; isSymlink?: boolean }[]>
  readTextFile(path: string): Promise<string>
}

/** Reads optional `snippets/*.md` files without allowing one broken file to hide the package. */
export async function readTemplateSnippets(
  fs: SnippetFs, root: string, templateId: string, group: string,
): Promise<{ snippets: TemplateSnippet[]; errors: string[] }> {
  const dir = `${root}/snippets`
  const snippets: TemplateSnippet[] = []
  const errors: string[] = []
  try {
    const directory = (await fs.readDir(root)).find((entry) => entry.name === 'snippets')
    if (!directory) return { snippets, errors }
    if (!directory.isDirectory || directory.isSymlink) {
      errors.push(`${templateId}/snippets: expected a real directory, not a symlink or file`)
      return { snippets, errors }
    }
  } catch (error) {
    errors.push(`${templateId}/snippets: ${error instanceof Error ? error.message : String(error)}`)
    return { snippets, errors }
  }
  let entries: Awaited<ReturnType<SnippetFs['readDir']>>
  try {
    entries = await fs.readDir(dir)
  } catch (error) {
    errors.push(`${templateId}/snippets: ${error instanceof Error ? error.message : String(error)}`)
    return { snippets, errors }
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory || entry.isSymlink || entry.name.startsWith('.') || !/\.md$/i.test(entry.name)) continue
    try {
      const raw = await fs.readTextFile(`${dir}/${entry.name}`)
      if (raw.length > 512 * 1024) throw new Error('larger than 512 KB')
      const { frontmatter, body } = parseDocument(raw)
      if (!body.trim()) throw new Error('empty snippet')
      const base = entry.name.replace(/\.md$/i, '')
      snippets.push({
        id: `${templateId}/${base}`,
        label: String(frontmatter.snippetName ?? base),
        group,
        markdown: body,
      })
    } catch (error) {
      errors.push(`${templateId}/snippets/${entry.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { snippets, errors }
}
