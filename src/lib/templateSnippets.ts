import { parseDocument } from './frontmatter'

export interface TemplateSnippet {
  id: string
  label: string
  group: string
  markdown: string
}

interface SnippetFs {
  exists(path: string): Promise<boolean>
  readDir(path: string): Promise<{ name: string; isDirectory: boolean; isSymlink?: boolean }[]>
  readTextFile(path: string): Promise<string>
}

/** Reads optional `snippets/*.md` files without allowing one broken file to hide the package. */
export async function readTemplateSnippets(
  fs: SnippetFs, root: string, templateId: string, group: string,
): Promise<{ snippets: TemplateSnippet[]; errors: string[] }> {
  const dir = `${root}/snippets`
  if (!(await fs.exists(dir))) return { snippets: [], errors: [] }
  const snippets: TemplateSnippet[] = []
  const errors: string[] = []
  for (const entry of (await fs.readDir(dir)).sort((a, b) => a.name.localeCompare(b.name))) {
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
